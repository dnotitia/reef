import { createHash, randomBytes } from "node:crypto";
import {
  decodeProtectedHeader,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";
import { z } from "zod";
import type { AkbAuthV2Config } from "@reef/core";
import type { AuthV2EnabledRuntimeConfig } from "./config";
import {
  createOidcTokenValidator,
  validateOidcTokenAndAccount,
  type AccountValidator,
  type OidcAuthenticatedPrincipal,
  type OidcTokenValidator,
  type ValidatedOidcToken,
} from "./oidcValidator";
import type {
  AuthV2LoginStateStore,
  AuthV2LoginTransaction,
} from "./loginStateStore";

type AuthV2ConsumedLoginTransaction = Omit<
  AuthV2LoginTransaction,
  "browser_binding"
>;

const MAX_OIDC_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOKEN_BYTES = 512 * 1024;
const MAX_REDIRECT_PATH_BYTES = 2_048;
const OIDC_TIMEOUT_MS = 5_000;
const MAX_ACCESS_TOKEN_SECONDS = 86_400;
const MAX_REFRESH_TOKEN_SECONDS = 31_536_000;
const PROVIDER_ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/u;

const AuthorizationTokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(MAX_TOKEN_BYTES),
    refresh_token: z.string().min(1).max(MAX_TOKEN_BYTES),
    id_token: z.string().min(1).max(MAX_TOKEN_BYTES),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive().max(MAX_ACCESS_TOKEN_SECONDS),
    refresh_expires_in: z
      .number()
      .int()
      .positive()
      .max(MAX_REFRESH_TOKEN_SECONDS),
  })
  // Keycloak adds standards-defined metadata such as `session_state`,
  // `scope`, and `not-before-policy`.  Validate the fields Reef consumes and
  // strip the rest so harmless provider evolution does not break login.
  .strip();

const RefreshTokenResponseSchema = z
  .object({
    access_token: z.string().min(1).max(MAX_TOKEN_BYTES),
    refresh_token: z.string().min(1).max(MAX_TOKEN_BYTES).optional(),
    id_token: z.string().min(1).max(MAX_TOKEN_BYTES).optional(),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive().max(MAX_ACCESS_TOKEN_SECONDS),
    refresh_expires_in: z
      .number()
      .int()
      .positive()
      .max(MAX_REFRESH_TOKEN_SECONDS)
      .optional(),
  })
  .strip();

export interface AuthV2OidcTokenSet {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

export interface AuthV2AuthorizationStart {
  location: string;
  state: string;
  browserBinding: string;
}

export interface AuthV2AuthorizationResult<Account> {
  providerAlias: string;
  redirectPath: string;
  subject: string;
  sessionId?: string;
  identity: ValidatedOidcToken;
  account: Account;
  tokenSet: AuthV2OidcTokenSet;
}

export type AuthV2OidcProtocolErrorKind =
  | "invalid"
  | "rejected"
  | "unavailable";

export class AuthV2OidcProtocolError extends Error {
  constructor(
    readonly code:
      | "auth_v2_authorization_input_invalid"
      | "auth_v2_state_invalid"
      | "auth_v2_upstream_unavailable"
      | "auth_v2_code_rejected"
      | "auth_v2_token_response_invalid"
      | "auth_v2_id_token_invalid"
      | "auth_v2_refresh_rejected"
      | "auth_v2_revocation_failed",
    readonly kind: AuthV2OidcProtocolErrorKind,
  ) {
    super(code);
    this.name = "AuthV2OidcProtocolError";
  }
}

export interface AuthV2OidcProtocol {
  beginAuthorization(input: {
    stateStore: AuthV2LoginStateStore;
    redirectPath: string;
  }): Promise<AuthV2AuthorizationStart>;
  completeAuthorization<Account>(input: {
    stateStore: AuthV2LoginStateStore;
    code: string;
    state: string;
    browserBinding: string;
    accountValidator: AccountValidator<Account>;
  }): Promise<AuthV2AuthorizationResult<Account>>;
  refresh(input: {
    refreshToken: string;
    providerAlias: string;
    subject: string;
    sessionId?: string;
    previousIdToken?: string;
  }): Promise<AuthV2OidcTokenSet>;
  revoke(refreshToken: string): Promise<void>;
  logoutLocation(): string;
  validator: OidcTokenValidator;
}

/**
 * Reef-owned OIDC protocol for the future auth-v2 profile. It is deliberately
 * dependency-injected and route-agnostic: callers must provide the encrypted
 * Redis-backed state store and the explicit AKB account validator. No account
 * is ever projected from Keycloak claims alone.
 */
export function createAuthV2OidcProtocol(params: {
  runtime: AuthV2EnabledRuntimeConfig;
  contract: Extract<AkbAuthV2Config, { auth_mode: "sso" }>;
  providerAlias: string;
  jwks: JWTVerifyGetKey;
  fetch?: typeof fetch;
  now?: () => number;
}): AuthV2OidcProtocol {
  const fetchImpl = params.fetch ?? fetch;
  const now = params.now ?? (() => Math.floor(Date.now() / 1_000));
  const provider = params.contract.providers.find(
    (entry) => entry.alias === params.providerAlias,
  );
  if (
    !provider ||
    !PROVIDER_ALIAS_RE.test(params.providerAlias) ||
    params.contract.canonical_issuer !== params.runtime.issuer ||
    !params.contract.accepted_audiences.includes(params.runtime.audience) ||
    !params.contract.accepted_clients.includes(params.runtime.clientId)
  ) {
    throw new AuthV2OidcProtocolError(
      "auth_v2_authorization_input_invalid",
      "invalid",
    );
  }

  const endpoints = keycloakEndpoints(params.runtime);
  const validator = createOidcTokenValidator({
    canonicalIssuer: params.contract.canonical_issuer,
    // The AKB catalog is an allowlist of possible deployments.  This Reef
    // runtime pins validation to the one audience/client selected by its
    // deployment environment; another catalog entry must not widen trust.
    audience: params.runtime.audience,
    clientId: params.runtime.clientId,
    providerAlias: params.providerAlias,
    jwks: params.jwks,
    now: () => new Date(now() * 1_000),
  });

  return {
    validator,

    async beginAuthorization({ stateStore, redirectPath }) {
      if (!isSafeRedirectPath(redirectPath)) {
        throw new AuthV2OidcProtocolError(
          "auth_v2_authorization_input_invalid",
          "invalid",
        );
      }
      const codeVerifier = randomVerifier();
      const nonce = randomOpaqueValue();
      const issued = await stateStore.issue({
        providerAlias: params.providerAlias,
        redirectPath,
        clientId: params.runtime.clientId,
        codeVerifier,
        nonce,
      });
      const location = new URL(endpoints.authorization);
      location.searchParams.set("client_id", params.runtime.clientId);
      location.searchParams.set("redirect_uri", callbackUri(params.runtime));
      location.searchParams.set("response_type", "code");
      location.searchParams.set("response_mode", "query");
      location.searchParams.set("scope", "openid");
      location.searchParams.set("state", issued.state);
      location.searchParams.set("nonce", nonce);
      location.searchParams.set("code_challenge", codeChallenge(codeVerifier));
      location.searchParams.set("code_challenge_method", "S256");
      location.searchParams.set("kc_idp_hint", params.providerAlias);
      return {
        location: location.toString(),
        state: issued.state,
        browserBinding: issued.browserBinding,
      };
    },

    async completeAuthorization<Account>({
      stateStore,
      code,
      state,
      browserBinding,
      accountValidator,
    }: {
      stateStore: AuthV2LoginStateStore;
      code: string;
      state: string;
      browserBinding: string;
      accountValidator: AccountValidator<Account>;
    }) {
      if (!isBoundedCode(code)) {
        throw new AuthV2OidcProtocolError("auth_v2_state_invalid", "invalid");
      }
      const transaction = await stateStore.consume(state, browserBinding);
      if (!transaction || transaction.client_id !== params.runtime.clientId) {
        throw new AuthV2OidcProtocolError("auth_v2_state_invalid", "invalid");
      }
      let tokenSet: AuthV2OidcTokenSet;
      try {
        const raw = await requestTokenResponse(
          new URLSearchParams({
            grant_type: "authorization_code",
            client_id: params.runtime.clientId,
            redirect_uri: callbackUri(params.runtime),
            code,
            code_verifier: transaction.code_verifier,
          }),
          "authorization",
        );
        tokenSet = await validateAuthorizationResponse(
          raw,
          transaction,
          validator,
          params.jwks,
          params.runtime,
          params.providerAlias,
          now,
        );
      } catch (error) {
        if (error instanceof AuthV2OidcProtocolError) throw error;
        throw new AuthV2OidcProtocolError(
          "auth_v2_token_response_invalid",
          "invalid",
        );
      }

      const principal: OidcAuthenticatedPrincipal<Account> =
        await validateOidcTokenAndAccount(
          tokenSet.accessToken,
          validator,
          accountValidator,
        );
      return {
        providerAlias: params.providerAlias,
        redirectPath: transaction.redirect_path,
        subject: principal.identity.subject,
        ...(principal.identity.sessionId
          ? { sessionId: principal.identity.sessionId }
          : {}),
        identity: principal.identity,
        account: principal.account,
        tokenSet,
      };
    },

    async refresh(input) {
      if (
        !isBoundedToken(input.refreshToken) ||
        !PROVIDER_ALIAS_RE.test(input.providerAlias) ||
        !isBoundedClaim(input.subject)
      ) {
        throw new AuthV2OidcProtocolError(
          "auth_v2_refresh_rejected",
          "rejected",
        );
      }
      const raw = await requestTokenResponse(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: params.runtime.clientId,
          refresh_token: input.refreshToken,
        }),
        "refresh",
      );
      const parsed = RefreshTokenResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AuthV2OidcProtocolError(
          "auth_v2_token_response_invalid",
          "invalid",
        );
      }
      const accessIdentity = await validator.validate(parsed.data.access_token);
      if (
        accessIdentity.subject !== input.subject ||
        accessIdentity.providerAlias !== input.providerAlias ||
        (input.sessionId !== undefined &&
          accessIdentity.sessionId !== undefined &&
          accessIdentity.sessionId !== input.sessionId)
      ) {
        throw new AuthV2OidcProtocolError(
          "auth_v2_refresh_rejected",
          "rejected",
        );
      }
      if (parsed.data.id_token) {
        await verifyIdToken(
          parsed.data.id_token,
          parsed.data.access_token,
          undefined,
          params.runtime,
          params.jwks,
          accessIdentity.subject,
          input.sessionId,
          now,
        );
      }
      const nextIdToken = parsed.data.id_token ?? input.previousIdToken;
      if (!nextIdToken) {
        // An auth-v2 session always has an ID token from the authorization-code
        // exchange. Do not manufacture an empty credential when a refresh
        // response omits it; callers must provide the previous token so the
        // encrypted session record remains schema-valid.
        throw new AuthV2OidcProtocolError(
          "auth_v2_token_response_invalid",
          "invalid",
        );
      }
      const refreshExpiresAt =
        now() + (parsed.data.refresh_expires_in ?? MAX_REFRESH_TOKEN_SECONDS);
      return {
        accessToken: parsed.data.access_token,
        refreshToken: parsed.data.refresh_token ?? input.refreshToken,
        idToken: nextIdToken,
        accessTokenExpiresAt: boundedExpiry(
          now(),
          parsed.data.expires_in,
          accessIdentity.expiresAt,
        ),
        refreshTokenExpiresAt: refreshExpiresAt,
      };
    },

    async revoke(refreshToken) {
      if (!isBoundedToken(refreshToken)) {
        throw new AuthV2OidcProtocolError(
          "auth_v2_revocation_failed",
          "invalid",
        );
      }
      try {
        const response = await fetchImpl(endpoints.revocation, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: params.runtime.clientId,
            token: refreshToken,
            token_type_hint: "refresh_token",
          }),
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
        });
        if (!response.ok) {
          throw new AuthV2OidcProtocolError(
            "auth_v2_revocation_failed",
            "unavailable",
          );
        }
      } catch (error) {
        if (error instanceof AuthV2OidcProtocolError) throw error;
        throw new AuthV2OidcProtocolError(
          "auth_v2_revocation_failed",
          "unavailable",
        );
      }
    },

    logoutLocation() {
      const location = new URL(endpoints.logout);
      location.searchParams.set("client_id", params.runtime.clientId);
      location.searchParams.set(
        "post_logout_redirect_uri",
        `${params.runtime.publicOrigin}/login`,
      );
      return location.toString();
    },
  };

  async function requestTokenResponse(
    body: URLSearchParams,
    operation: "authorization" | "refresh",
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(endpoints.token, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
      });
    } catch {
      throw new AuthV2OidcProtocolError(
        "auth_v2_upstream_unavailable",
        "unavailable",
      );
    }
    if (!response.ok) {
      throw new AuthV2OidcProtocolError(
        operation === "refresh"
          ? "auth_v2_refresh_rejected"
          : "auth_v2_code_rejected",
        operation === "refresh" ? "rejected" : "rejected",
      );
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_OIDC_RESPONSE_BYTES
    ) {
      throw new AuthV2OidcProtocolError(
        "auth_v2_token_response_invalid",
        "invalid",
      );
    }
    try {
      const bodyBytes = await response.arrayBuffer();
      if (bodyBytes.byteLength > MAX_OIDC_RESPONSE_BYTES) {
        throw new Error("response too large");
      }
      return JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown;
    } catch {
      throw new AuthV2OidcProtocolError(
        "auth_v2_token_response_invalid",
        "invalid",
      );
    }
  }
}

async function validateAuthorizationResponse(
  raw: unknown,
  transaction: AuthV2ConsumedLoginTransaction,
  validator: OidcTokenValidator,
  jwks: JWTVerifyGetKey,
  runtime: AuthV2EnabledRuntimeConfig,
  providerAlias: string,
  now: () => number,
): Promise<AuthV2OidcTokenSet> {
  const parsed = AuthorizationTokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthV2OidcProtocolError(
      "auth_v2_token_response_invalid",
      "invalid",
    );
  }
  const identity = await validator.validate(parsed.data.access_token);
  await verifyIdToken(
    parsed.data.id_token,
    parsed.data.access_token,
    transaction.nonce,
    runtime,
    jwks,
    identity.subject,
    identity.sessionId,
    now,
  );
  if (identity.providerAlias !== providerAlias) {
    throw new AuthV2OidcProtocolError("auth_v2_id_token_invalid", "invalid");
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    idToken: parsed.data.id_token,
    accessTokenExpiresAt: boundedExpiry(
      now(),
      parsed.data.expires_in,
      identity.expiresAt,
    ),
    refreshTokenExpiresAt: now() + parsed.data.refresh_expires_in,
  };
}

async function verifyIdToken(
  idToken: string,
  accessToken: string,
  expectedNonce: string | undefined,
  runtime: AuthV2EnabledRuntimeConfig,
  jwks: JWTVerifyGetKey,
  subject: string,
  expectedSessionId: string | undefined,
  now: () => number,
): Promise<JWTPayload> {
  try {
    const header = decodeProtectedHeader(idToken);
    if (
      header.alg !== "RS256" ||
      header.typ !== "JWT" ||
      typeof header.kid !== "string" ||
      header.kid.length === 0 ||
      header.kid.length > 255 ||
      ["jku", "jwk", "x5u", "x5c"].some((name) => name in header)
    ) {
      throw new Error("id token header");
    }
    const { payload } = await jwtVerify(idToken, jwks, {
      algorithms: ["RS256"],
      issuer: runtime.issuer,
      audience: runtime.clientId,
      currentDate: new Date(now() * 1_000),
      clockTolerance: 5,
    });
    const nonceMatches =
      expectedNonce === undefined || payload.nonce === expectedNonce;
    const atHashMatches =
      payload.at_hash === undefined ||
      payload.at_hash === accessTokenHash(accessToken);
    if (
      payload.azp !== runtime.clientId ||
      !nonceMatches ||
      payload.sub !== subject ||
      (expectedSessionId !== undefined &&
        payload.sid !== undefined &&
        payload.sid !== expectedSessionId) ||
      !atHashMatches
    ) {
      throw new Error("id token claims");
    }
    return payload;
  } catch {
    throw new AuthV2OidcProtocolError("auth_v2_id_token_invalid", "invalid");
  }
}

function keycloakEndpoints(runtime: AuthV2EnabledRuntimeConfig) {
  const issuer = runtime.issuer.replace(/\/$/u, "");
  const transport = runtime.transportUrl.replace(/\/$/u, "");
  return {
    authorization: `${issuer}/protocol/openid-connect/auth`,
    token: `${transport}/protocol/openid-connect/token`,
    revocation: `${transport}/protocol/openid-connect/revoke`,
    logout: `${issuer}/protocol/openid-connect/logout`,
  };
}

function callbackUri(runtime: AuthV2EnabledRuntimeConfig): string {
  return `${runtime.publicOrigin}/api/auth/v2/callback`;
}

function randomOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

function randomVerifier(): string {
  return randomBytes(48).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function accessTokenHash(accessToken: string): string {
  return createHash("sha256")
    .update(accessToken, "ascii")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function boundedExpiry(
  now: number,
  expiresIn: number,
  jwtExpiry: number,
): number {
  if (!Number.isSafeInteger(jwtExpiry) || jwtExpiry <= now) {
    throw new AuthV2OidcProtocolError(
      "auth_v2_token_response_invalid",
      "invalid",
    );
  }
  return Math.min(now + expiresIn, jwtExpiry);
}

function isSafeRedirectPath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.length > MAX_REDIRECT_PATH_BYTES ||
    hasControlCharacter(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value, "https://reef.invalid");
    return parsed.origin === "https://reef.invalid" && parsed.hash === "";
  } catch {
    return false;
  }
}

function isBoundedCode(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 4_096;
}

function isBoundedToken(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TOKEN_BYTES
  );
}

function isBoundedClaim(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
