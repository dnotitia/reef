import type {
  OAuthClientInformationFull,
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  akbGetMe,
  AuthError,
  createAkbAdapter,
  isAkbAccountErrorCode,
} from "@reef/core";
import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { buildPathWithParams } from "@/lib/akb/safeRedirect";
import { buildClearedEstablishedAuthCookies } from "@/lib/akb/sessionCookie";
import { logger } from "@/lib/logging/logger";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { resolveLocale } from "@/i18n/detectLocale";
import { loadMessages } from "@/i18n/messages";
import {
  AUTH_V2_SESSION_COOKIE,
  buildClearedAuthV2LogoutCookie,
  buildClearedAuthV2SessionCookie,
  buildClearedAuthV2StateCookie,
  readAuthV2Cookies,
} from "@/server/auth-v2/cookie";
import { getProcessAuthV2Redis } from "@/server/auth-v2/redisRuntime";
import { resolveAuthV2Credential } from "@/server/auth-v2/routeHelpers";
import {
  AuthV2RouteRuntimeError,
  getAuthV2RouteRuntime,
} from "@/server/auth-v2/runtime";
import { readAuthV2RuntimeConfig } from "@/server/auth-v2/config";
import {
  AUTHORIZE,
  AuthorizationInput,
  CONSENT,
  ConsentInput,
  OAuthFailure,
  REGISTER,
  RESOURCE_METADATA,
  RESPONSE_HEADERS,
  RegistrationInput,
  TOKEN,
  TokenInput,
  oauthJson,
  requestBody,
  uniqueParams,
} from "./oauthProtocol";
import {
  GRANT_TTL,
  OPAQUE,
  PENDING_TTL,
  PLUGIN_SCOPE,
  createPluginOAuthStore,
  digest,
  opaqueValue,
} from "./oauthStore";

const BROWSER_COOKIE = "__reef_plugin_consent";

function deployment() {
  const config = readAuthV2RuntimeConfig();
  if (!config.enabled) throw new OAuthFailure("reef_sso_required", 404);
  return {
    config,
    origin: config.publicOrigin,
    resource: `${config.publicOrigin}/mcp`,
  };
}

async function oauthContext(request: Request) {
  const { config, origin, resource } = deployment();
  const runtime = await getAuthV2RouteRuntime(request);
  const redis = await getProcessAuthV2Redis(config);
  return {
    runtime,
    origin,
    resource,
    store: createPluginOAuthStore(config, redis, runtime.now),
  };
}

async function runOAuth(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OAuthFailure) {
      return oauthJson({ error: error.code }, error.status);
    }
    if (
      error instanceof AuthV2RouteRuntimeError &&
      error.code === "auth_v2_contract_invalid"
    ) {
      return oauthJson({ error: "reef_sso_required" }, 404);
    }
    logger.warn(
      { code: "plugin_oauth_unavailable" },
      "Reef plugin OAuth request failed",
    );
    return oauthJson({ error: "temporarily_unavailable" }, 503);
  }
}

export function resourceMetadata() {
  return runOAuth(async () => {
    const { origin, resource } = deployment();
    return oauthJson({
      resource,
      authorization_servers: [origin],
      scopes_supported: [PLUGIN_SCOPE],
      bearer_methods_supported: ["header"],
    } satisfies OAuthProtectedResourceMetadata);
  });
}

export function issuerMetadata() {
  return runOAuth(async () => {
    const { origin } = deployment();
    return oauthJson({
      issuer: origin,
      authorization_endpoint: origin + AUTHORIZE,
      token_endpoint: origin + TOKEN,
      registration_endpoint: origin + REGISTER,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [PLUGIN_SCOPE],
    } satisfies OAuthMetadata);
  });
}

export function registerClient(request: Request) {
  return runOAuth(async () => {
    const input = RegistrationInput.safeParse(
      await requestBody(request, "application/json"),
    );
    if (!input.success) throw new OAuthFailure("invalid_client_metadata");
    const { store } = await oauthContext(request);
    const callback = input.data.redirect_uris[0];
    const clientId = await store.clients.issue({ callback });
    if (!clientId) throw new OAuthFailure("temporarily_unavailable", 429);
    return oauthJson(
      {
        client_id: clientId,
        redirect_uris: [callback],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "native",
        scope: PLUGIN_SCOPE,
      } satisfies OAuthClientInformationFull,
      201,
    );
  });
}

export function authorize(request: Request) {
  return runOAuth(async () => {
    const query = new URL(request.url).search;
    if (query.length > 4_096) throw new OAuthFailure("invalid_request");
    const input = AuthorizationInput.safeParse(
      uniqueParams(new URLSearchParams(query)),
    );
    if (!input.success) throw new OAuthFailure("invalid_request");
    const { resource, origin, store } = await oauthContext(request);
    const fields = input.data;
    if (fields.resource !== resource) throw new OAuthFailure("invalid_target");
    const client = await store.clients.read(fields.client_id);
    if (client?.callback !== fields.redirect_uri)
      throw new OAuthFailure("invalid_client");
    const browser = opaqueValue();
    const transaction = await store.pending.issue({
      clientId: fields.client_id,
      callback: client.callback,
      resource,
      scope: fields.scope,
      challenge: fields.code_challenge,
      state: fields.state,
      browserDigest: digest(browser),
    });
    if (!transaction) throw new OAuthFailure("temporarily_unavailable", 429);
    return redirect(consentPath(transaction), {
      "Set-Cookie": consentCookie(origin, browser, PENDING_TTL),
    });
  });
}

function consentPath(transaction: string) {
  return buildPathWithParams(CONSENT, { transaction });
}

function consentCookie(origin: string, value: string, ttl: number) {
  return `${BROWSER_COOKIE}=${value}; Path=${CONSENT}; HttpOnly; SameSite=Lax; Max-Age=${ttl}${
    origin.startsWith("https:") ? "; Secure" : ""
  }`;
}

function redirect(location: string, headers?: HeadersInit) {
  const response = new Response(null, {
    status: 303,
    headers: RESPONSE_HEADERS,
  });
  response.headers.set("Location", location);
  new Headers(headers).forEach((value, name) =>
    response.headers.append(name, value),
  );
  return response;
}

function actionNonce(browser: string, transaction: string, handle: string) {
  return createHmac("sha256", browser)
    .update(transaction)
    .update(handle)
    .digest("base64url");
}

function equalOpaque(expected: string, value: string) {
  return timingSafeEqual(Buffer.from(expected), Buffer.from(value));
}

function browserValue(request: Request) {
  return OPAQUE.safeParse(readAuthV2Cookies(request)[BROWSER_COOKIE]);
}

function browserHandle(request: Request) {
  return OPAQUE.safeParse(readAuthV2Cookies(request)[AUTH_V2_SESSION_COOKIE]);
}

async function verifiedAdapter(request: Request, handle: string) {
  const credential = await resolveAuthV2Credential(request, handle);
  const adapter = createAkbAdapter({ baseUrl: getAkbBackendUrl(), credential });
  await akbGetMe({ adapter });
  return adapter;
}

function invalidateCookies(response: Response) {
  for (const cookie of [
    ...buildClearedEstablishedAuthCookies(),
    buildClearedAuthV2SessionCookie(),
    buildClearedAuthV2StateCookie(),
    buildClearedAuthV2LogoutCookie(),
  ]) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

function authFailure(error: AuthError) {
  const code = error.context.code;
  return invalidateCookies(
    oauthJson(
      {
        error: isAkbAccountErrorCode(code) ? code : "invalid_token",
      },
      401,
    ),
  );
}

function consentLocale(request: Request) {
  const locale = resolveLocale(
    readAuthV2Cookies(request)[LOCALE_COOKIE],
    request.headers.get("accept-language"),
  );
  return { locale, copy: loadMessages(locale).reefPlugin.consent };
}

export function renderConsent(request: Request) {
  return runOAuth(async () => {
    const query = new URL(request.url).search;
    if (query.length > 256) throw new OAuthFailure("invalid_request");
    const input = ConsentInput.pick({ transaction: true }).safeParse(
      uniqueParams(new URLSearchParams(query)),
    );
    const browser = browserValue(request);
    if (!input.success || !browser.success)
      throw new OAuthFailure("invalid_request");
    const { transaction } = input.data;
    const { store, runtime, resource } = await oauthContext(request);
    const pending = await store.pending.read(transaction);
    if (
      !pending ||
      pending.resource !== resource ||
      !equalOpaque(pending.browserDigest, digest(browser.data))
    ) {
      throw new OAuthFailure("invalid_request");
    }
    const handle = browserHandle(request);
    const login = () =>
      redirect(
        buildPathWithParams("/login", {
          redirect: consentPath(transaction),
        }),
      );
    if (!handle.success) return login();
    if (!(await runtime.store.resolve(handle.data)))
      return invalidateCookies(login());
    try {
      await verifiedAdapter(request, handle.data);
    } catch (error) {
      if (error instanceof AuthError) return authFailure(error);
      throw error;
    }
    const { locale, copy } = consentLocale(request);
    const nonce = actionNonce(browser.data, transaction, handle.data);
    return new Response(
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${copy.title}</title>
<style>body{font:1rem system-ui;color:#142520;background:#f4f8f6;margin:0;padding:1rem}
main{max-width:32rem;margin:12vh auto;padding:1.5rem;background:white;border:1px solid #c6d8d0;border-radius:0.75rem}
button{font:inherit;padding:.65rem 1rem;margin:.25rem;border:1px solid #226349;border-radius:.4rem;background:white;color:#184632}
button[value=approve]{background:#226349;color:white}p{line-height:1.5}</style></head>
<body><main><h1>${copy.title}</h1><p>${copy.description}</p><form method="post" action="${CONSENT}">
<input type="hidden" name="transaction" value="${transaction}"><input type="hidden" name="action" value="${nonce}">
<button name="decision" value="deny">${copy.deny}</button>
<button name="decision" value="approve">${copy.approve}</button>
</form></main></body></html>`,
      {
        headers: {
          ...RESPONSE_HEADERS,
          // Keep the form POST's Origin while dropping cross-origin referrers.
          "Referrer-Policy": "same-origin",
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    );
  });
}

export function decideConsent(request: Request) {
  return runOAuth(async () => {
    const { origin } = deployment();
    if (request.headers.get("origin") !== origin)
      throw new OAuthFailure("invalid_request", 403);
    const input = ConsentInput.safeParse(
      await requestBody(request, "application/x-www-form-urlencoded"),
    );
    const browser = browserValue(request);
    const handle = browserHandle(request);
    if (!input.success || !browser.success || !handle.success) {
      throw new OAuthFailure("invalid_request");
    }
    const { transaction, action, decision } = input.data;
    if (
      !equalOpaque(actionNonce(browser.data, transaction, handle.data), action)
    ) {
      throw new OAuthFailure("invalid_request", 403);
    }
    const { store, resource, runtime } = await oauthContext(request);
    const pending = await store.pending.read(transaction);
    if (
      !pending ||
      pending.resource !== resource ||
      !equalOpaque(pending.browserDigest, digest(browser.data))
    ) {
      throw new OAuthFailure("invalid_request");
    }
    const client = await store.clients.read(pending.clientId);
    if (client?.callback !== pending.callback)
      throw new OAuthFailure("invalid_client");
    try {
      await verifiedAdapter(request, handle.data);
    } catch (error) {
      if (error instanceof AuthError) return authFailure(error);
      throw error;
    }
    const session = await runtime.store.resolve(handle.data);
    if (!session)
      return invalidateCookies(oauthJson({ error: "invalid_token" }, 401));
    const consumed = await store.pending.read(transaction, true);
    if (!consumed) throw new OAuthFailure("invalid_request");
    const { state, browserDigest: _browserDigest, ...binding } = consumed;
    const callback = new URL(binding.callback);
    if (decision === "approve") {
      const code = await store.codes.issue({
        ...binding,
        session: { handle: handle.data, deadline: session.absolute_expires_at },
      });
      if (!code) throw new OAuthFailure("temporarily_unavailable", 503);
      callback.searchParams.set("code", code);
    } else {
      callback.searchParams.set("error", "access_denied");
    }
    callback.searchParams.set("state", state);
    const { locale, copy } = consentLocale(request);
    const destination = callback.href
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    // A new document separates the same-origin form submission from navigation
    // to the native client's loopback origin under Reef's form-action policy.
    const response = new Response(
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${destination}"><title>${copy.returnToClient}</title>
</head><body><a href="${destination}">${copy.returnToClient}</a></body></html>`,
      {
        headers: {
          ...RESPONSE_HEADERS,
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    );
    response.headers.set("Set-Cookie", consentCookie(origin, "", 0));
    return response;
  });
}

export function exchangeCode(request: Request) {
  return runOAuth(async () => {
    const body = await requestBody(
      request,
      "application/x-www-form-urlencoded",
    );
    if (
      typeof body === "object" &&
      body !== null &&
      "grant_type" in body &&
      body.grant_type !== "authorization_code"
    ) {
      throw new OAuthFailure("unsupported_grant_type");
    }
    const input = TokenInput.safeParse(body);
    if (!input.success) throw new OAuthFailure("invalid_request");
    const { resource, store, runtime } = await oauthContext(request);
    const fields = input.data;
    if (fields.resource !== resource) throw new OAuthFailure("invalid_target");
    const code = await store.codes.read(fields.code);
    if (
      !code ||
      code.clientId !== fields.client_id ||
      code.callback !== fields.redirect_uri ||
      code.resource !== resource ||
      !equalOpaque(code.challenge, digest(fields.code_verifier))
    ) {
      throw new OAuthFailure("invalid_grant");
    }
    const client = await store.clients.read(code.clientId);
    if (client?.callback !== code.callback)
      throw new OAuthFailure("invalid_grant");
    const session = await runtime.store.resolve(code.session.handle);
    const ttl = Math.min(GRANT_TTL, code.session.deadline - runtime.now());
    if (!session || ttl <= 0 || !(await store.codes.read(fields.code, true))) {
      throw new OAuthFailure("invalid_grant");
    }
    const accessToken = await store.grants.issue(
      {
        clientId: code.clientId,
        scope: code.scope,
        resource,
        session: code.session,
      },
      ttl,
    );
    if (!accessToken) throw new OAuthFailure("temporarily_unavailable", 503);
    return oauthJson({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ttl,
      scope: PLUGIN_SCOPE,
    } satisfies OAuthTokens);
  });
}

export async function authenticateMcp(request: Request) {
  const { origin, resource } = deployment();
  const suppliedOrigin = request.headers.get("origin");
  if (suppliedOrigin !== null && suppliedOrigin !== origin) {
    throw new OAuthFailure("invalid_origin", 403);
  }
  const header = request.headers.get("authorization");
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/iu.exec(header ?? "")?.[1];
  if (!token)
    throw new OAuthFailure(header ? "invalid_token" : "unauthorized", 401);
  const { store, runtime } = await oauthContext(request);
  const grant = await store.grants.read(token);
  if (
    !grant ||
    grant.resource !== resource ||
    grant.session.deadline <= runtime.now()
  ) {
    throw new OAuthFailure("invalid_token", 401);
  }
  return verifiedAdapter(request, grant.session.handle);
}

export function isResourceDenial(error: unknown) {
  return (
    error instanceof AuthError &&
    error.context.status === 403 &&
    !isAkbAccountErrorCode(error.context.code)
  );
}

export function mcpAuthError(error: unknown) {
  const response = isResourceDenial(error)
    ? oauthJson({ error: "access_denied" }, 403)
    : error instanceof AuthError
      ? authFailure(error)
      : error instanceof OAuthFailure
        ? oauthJson({ error: error.code }, error.status)
        : oauthJson({ error: "temporarily_unavailable" }, 503);
  if (response.status === 401) {
    const { origin } = deployment();
    const invalid =
      error instanceof OAuthFailure && error.code === "unauthorized"
        ? ""
        : ', error="invalid_token"';
    response.headers.set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${origin}${RESOURCE_METADATA}"${invalid}`,
    );
  }
  return response;
}
