import type {
  OAuthClientInformationFull,
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/server";
import { createHmac } from "node:crypto";
import {
  akbGetMe,
  AuthError,
  createAkbAdapter,
  isAkbAccountErrorCode,
} from "@reef/core";
import { getAkbBackendUrl } from "@/lib/akb/akbBackendUrl";
import { buildPathWithParams } from "@/lib/akb/safeRedirect";
import { withClearedEstablishedAuthCookies } from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { resolveLocale } from "@/i18n/detectLocale";
import { loadMessages } from "@/i18n/messages";
import {
  AUTH_V2_SESSION_COOKIE,
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
} from "./oauthStore";

import { createOAuthBrowserState, equalOpaque } from "./oauthBrowserState";

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
    browserState: createOAuthBrowserState(config),
    store: createPluginOAuthStore(config, redis, runtime.now),
  };
}

async function runOAuth(
  operation: () => Promise<Response>,
  browserRequest?: Request,
) {
  const failure = (code: string, status: number) =>
    browserRequest
      ? browserFailure(browserRequest, code, status)
      : oauthJson({ error: code }, status);
  try {
    return await operation();
  } catch (error) {
    if (browserRequest && error instanceof AuthError) {
      const code = accountError(error);
      return withClearedEstablishedAuthCookies(
        failure(code ?? "invalid_token", 401),
        code,
      );
    }
    if (error instanceof OAuthFailure) return failure(error.code, error.status);
    if (
      error instanceof AuthV2RouteRuntimeError &&
      error.code === "auth_v2_contract_invalid"
    )
      return failure("reef_sso_required", 404);
    logger.warn(
      { code: "plugin_oauth_unavailable" },
      "Reef plugin OAuth request failed",
    );
    return failure("temporarily_unavailable", 503);
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
    const { config } = deployment();
    const callback = input.data.redirect_uris[0];
    const clientId = createOAuthBrowserState(config).register(callback);
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
    const { resource, origin, config } = deployment();
    const fields = input.data;
    if (fields.resource !== resource) throw new OAuthFailure("invalid_target");
    const browserState = createOAuthBrowserState(config);
    if (!browserState.isRegistered(fields.client_id, fields.redirect_uri)) {
      throw new OAuthFailure("invalid_client");
    }
    const { transaction, sealed } = browserState.issueConsent({
      clientId: fields.client_id,
      callback: fields.redirect_uri,
      scope: fields.scope,
      challenge: fields.code_challenge,
      state: fields.state,
    });
    return redirect(consentPath(transaction), {
      "Set-Cookie": consentCookie(origin, sealed, PENDING_TTL),
    });
  }, request);
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

function browserValue(request: Request) {
  return readAuthV2Cookies(request)[BROWSER_COOKIE] ?? "";
}

function browserHandle(request: Request) {
  return OPAQUE.safeParse(readAuthV2Cookies(request)[AUTH_V2_SESSION_COOKIE]);
}

async function verifiedAdapter(request: Request, handle: string) {
  const adapter = createAkbAdapter({
    baseUrl: getAkbBackendUrl(),
    credential: () => resolveAuthV2Credential(request, handle),
  });
  await akbGetMe({ adapter });
  return adapter;
}

function accountError(error: AuthError) {
  const code = error.context.code;
  return isAkbAccountErrorCode(code) ? code : undefined;
}

function consentLocale(request: Request) {
  const locale = resolveLocale(
    readAuthV2Cookies(request)[LOCALE_COOKIE],
    request.headers.get("accept-language"),
  );
  return { locale, copy: loadMessages(locale).reefPlugin.consent };
}

function browserFailure(request: Request, code: string, status: number) {
  const { locale, copy } = consentLocale(request);
  const reason =
    status === 401
      ? copy.accountFailure
      : status >= 500
        ? copy.unavailable
        : code === "reef_sso_required"
          ? copy.ssoRequired
          : code === "invalid_target" || code === "invalid_client"
            ? copy.invalidConnection
            : copy.invalidConsent;
  return new Response(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${copy.failureTitle}</title>
</head><body><main><h1>${copy.failureTitle}</h1><p>${reason}</p><p>${copy.retry}</p></main></body></html>`,
    {
      status,
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export function renderConsent(request: Request) {
  return runOAuth(async () => {
    const query = new URL(request.url).search;
    if (query.length > 256) throw new OAuthFailure("invalid_request");
    const input = ConsentInput.pick({ transaction: true }).safeParse(
      uniqueParams(new URLSearchParams(query)),
    );
    if (!input.success) throw new OAuthFailure("invalid_request");
    const { transaction } = input.data;
    const browser = browserValue(request);
    const { config } = deployment();
    if (!createOAuthBrowserState(config).readConsent(transaction, browser)) {
      throw new OAuthFailure("invalid_request");
    }
    const runtime = await getAuthV2RouteRuntime(request);
    const handle = browserHandle(request);
    const login = () =>
      redirect(
        buildPathWithParams("/login", {
          redirect: consentPath(transaction),
        }),
      );
    if (!handle.success) return login();
    if (!(await runtime.store.resolve(handle.data))) {
      return withClearedEstablishedAuthCookies(login());
    }
    await verifiedAdapter(request, handle.data);
    const { locale, copy } = consentLocale(request);
    const nonce = actionNonce(browser, transaction, handle.data);
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
  }, request);
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
    if (!input.success || !handle.success)
      throw new OAuthFailure("invalid_request");
    const { transaction, action, decision } = input.data;
    const { config, resource } = deployment();
    const pending = createOAuthBrowserState(config).readConsent(
      transaction,
      browser,
    );
    if (
      !pending ||
      !equalOpaque(actionNonce(browser, transaction, handle.data), action)
    ) {
      throw new OAuthFailure("invalid_request", 403);
    }
    const { store, runtime } = await oauthContext(request);
    await verifiedAdapter(request, handle.data);
    const session = await runtime.store.resolve(handle.data);
    if (!session) {
      return withClearedEstablishedAuthCookies(
        browserFailure(request, "invalid_token", 401),
      );
    }
    const { state, expiresAt, ...binding } = pending;
    if (!(await store.claimConsent(transaction, expiresAt))) {
      throw new OAuthFailure("invalid_request");
    }
    const callback = new URL(binding.callback);
    if (decision === "approve") {
      const code = await store.codes.issue({
        ...binding,
        resource,
        session: { handle: handle.data, deadline: session.absolute_expires_at },
      });
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
  }, request);
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
    const { resource, store, runtime, browserState } =
      await oauthContext(request);
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
    if (!browserState.isRegistered(code.clientId, code.callback))
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
      ? oauthJson({ error: accountError(error) ?? "invalid_token" }, 401)
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
