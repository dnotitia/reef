import { createHash, randomBytes } from "node:crypto";
import {
  type JWTPayload,
  type JWTVerifyGetKey,
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  errors as joseErrors,
  jwtVerify,
} from "jose";
import { z } from "zod";
import type {
  EncryptedSessionRepository,
  SsoTokenSet,
} from "./sessionRepository";

const PROVIDER_ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/u;
const OPAQUE_VALUE_RE = /^[A-Za-z0-9_-]{43}$/u;
const MAX_OAUTH_VALUE_BYTES = 512 * 1024;
const LOGIN_TRANSACTION_TTL_MS = 10 * 60 * 1_000;
const OIDC_UPSTREAM_TIMEOUT_MS = 5_000;
const MAX_OIDC_RESPONSE_BYTES = 2 * 1024 * 1024;
const BACKCHANNEL_LOGOUT_MAX_AGE_SECONDS = 120;
const OIDC_CLOCK_TOLERANCE_SECONDS = 5;
const BACKCHANNEL_LOGOUT_EVENT =
  "http://schemas.openid.net/event/backchannel-logout";

const AuthorizationTokenResponseSchema = z.object({
  access_token: z.string().min(1).max(MAX_OAUTH_VALUE_BYTES),
  refresh_token: z.string().min(1).max(MAX_OAUTH_VALUE_BYTES),
  id_token: z.string().min(1).max(MAX_OAUTH_VALUE_BYTES),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(86_400),
  refresh_expires_in: z.number().int().positive().max(31_536_000),
});

const RefreshTokenResponseSchema = z.object({
  access_token: z.string().min(1).max(MAX_OAUTH_VALUE_BYTES),
  refresh_token: z.string().min(1).max(MAX_OAUTH_VALUE_BYTES).optional(),
  id_token: z.string().min(1).max(MAX_OAUTH_VALUE_BYTES).optional(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive().max(86_400),
  refresh_expires_in: z.number().int().positive().max(31_536_000).optional(),
});

export interface KeycloakOidcConfig {
  issuer: string;
  transportUrl: string;
  clientId: string;
  akbApiAudience: string;
  publicOrigin: string;
}

export interface AuthorizationStart {
  location: string;
  browserBinding: string;
}

export interface CompletedAuthorization {
  providerAlias: string;
  redirectPath: string;
  oidcNonce: string;
  subject: string;
  sessionId?: string;
  tokenSet: SsoTokenSet;
}

export class OidcProtocolError extends Error {
  constructor(
    readonly code: string,
    readonly kind: "rejected" | "transient" | "invalid",
  ) {
    super(code);
    this.name = "OidcProtocolError";
  }
}

class OidcResponseDeadlineError extends Error {}
class OidcResponseLimitError extends Error {}

export interface KeycloakOidcClient {
  checkReachability(): Promise<void>;
  beginAuthorization(
    repository: EncryptedSessionRepository,
    input: { providerAlias: string; redirectPath: string },
  ): Promise<AuthorizationStart>;
  completeAuthorization(
    repository: EncryptedSessionRepository,
    input: { code: string; state: string; browserBinding: string },
  ): Promise<CompletedAuthorization>;
  validateAuthorizationTokenSet(
    raw: unknown,
    expected: { nonce: string; providerAlias: string },
  ): Promise<SsoTokenSet>;
  refresh(
    refreshToken: string,
    expected: {
      nonce: string;
      providerAlias: string;
      subject?: string;
      sessionId?: string;
      idToken?: string;
    },
  ): Promise<SsoTokenSet>;
  revokeRefreshToken(refreshToken: string): Promise<void>;
  verifyBackchannelLogoutToken(logoutToken: string): Promise<{
    jti: string;
    subject?: string;
    sessionId?: string;
    replayTtlMs: number;
  }>;
  logoutLocation(): string;
}

export function createKeycloakOidcClient(
  config: KeycloakOidcConfig,
  dependencies: {
    fetch?: typeof fetch;
    jwks?: JWTVerifyGetKey;
    now?: () => number;
    upstreamTimeoutMs?: number;
    maxResponseBytes?: number;
  } = {},
): KeycloakOidcClient {
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1_000));
  const upstreamTimeoutMs =
    dependencies.upstreamTimeoutMs ?? OIDC_UPSTREAM_TIMEOUT_MS;
  const maxResponseBytes =
    dependencies.maxResponseBytes ?? MAX_OIDC_RESPONSE_BYTES;
  const endpoints = keycloakEndpoints(config.issuer, config.transportUrl);
  const usesRemoteJwks = dependencies.jwks === undefined;
  const jwks =
    dependencies.jwks ??
    createRemoteJWKSet(new URL(endpoints.jwks), {
      timeoutDuration: upstreamTimeoutMs,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60 * 1_000,
      [customFetch]: async (url, init) => {
        const response = await fetchImpl(url, {
          ...init,
          cache: "no-store",
        });
        if (response.status !== 200) return response;
        try {
          const payload = await readBoundedJson(response, {
            maxBytes: maxResponseBytes,
            signal: init.signal,
          });
          return Response.json(payload);
        } catch (error) {
          if (
            error instanceof OidcResponseDeadlineError ||
            init.signal.aborted
          ) {
            throw new DOMException("JWKS deadline exceeded", "TimeoutError");
          }
          throw new TypeError("oidc_jwks_response_invalid");
        }
      },
    });
  const redirectUri = `${config.publicOrigin}/api/auth/akb/sso/callback`;

  async function verifyAccessToken(
    token: string,
    providerAlias: string,
  ): Promise<JWTPayload> {
    assertPinnedHeader(token);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256"],
        issuer: config.issuer,
        audience: config.akbApiAudience,
        currentDate: new Date(now() * 1_000),
        clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,
      });
      if (
        payload.azp !== config.clientId ||
        payload.typ !== "Bearer" ||
        payload.identity_provider !== providerAlias ||
        typeof payload.sub !== "string" ||
        payload.sub.length === 0
      ) {
        throw new Error("claim mismatch");
      }
      return payload;
    } catch (error) {
      throw tokenVerificationError(error, usesRemoteJwks);
    }
  }

  async function verifyIdToken(
    token: string,
    accessToken: string,
    expected: {
      nonce: string;
      nonceRequired: boolean;
      subject: string;
    },
  ): Promise<JWTPayload> {
    assertPinnedHeader(token);
    try {
      const { payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256"],
        issuer: config.issuer,
        audience: config.clientId,
        currentDate: new Date(now() * 1_000),
        clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,
      });
      const nonceMatches = expected.nonceRequired
        ? payload.nonce === expected.nonce
        : payload.nonce === undefined || payload.nonce === expected.nonce;
      const accessTokenHashMatches =
        payload.at_hash === undefined ||
        payload.at_hash === accessTokenHash(accessToken);
      if (
        payload.azp !== config.clientId ||
        !nonceMatches ||
        payload.sub !== expected.subject ||
        !accessTokenHashMatches
      ) {
        throw new Error("claim mismatch");
      }
      return payload;
    } catch (error) {
      throw tokenVerificationError(error, usesRemoteJwks);
    }
  }

  async function requestTokens(
    body: URLSearchParams,
    failureKind: "authorization" | "refresh",
  ): Promise<unknown> {
    const signal = AbortSignal.timeout(upstreamTimeoutMs);
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
        signal,
      });
    } catch {
      throw new OidcProtocolError("oidc_upstream_unavailable", "transient");
    }
    if (!response.ok) {
      if (
        failureKind === "refresh" &&
        (response.status === 400 || response.status === 401)
      ) {
        throw new OidcProtocolError("oidc_refresh_rejected", "rejected");
      }
      const transient = isTransientUpstreamStatus(response.status);
      throw new OidcProtocolError(
        transient ? "oidc_upstream_unavailable" : "oidc_exchange_rejected",
        transient ? "transient" : "rejected",
      );
    }
    try {
      return await readBoundedJson(response, {
        maxBytes: maxResponseBytes,
        signal,
      });
    } catch (error) {
      if (error instanceof OidcResponseDeadlineError || signal.aborted) {
        throw new OidcProtocolError("oidc_upstream_unavailable", "transient");
      }
      throw new OidcProtocolError("oidc_token_response_invalid", "invalid");
    }
  }

  async function validateAuthorizationTokenSet(
    raw: unknown,
    expected: { nonce: string; providerAlias: string },
  ): Promise<SsoTokenSet> {
    return (await validateAuthorization(raw, expected)).tokenSet;
  }

  async function validateAuthorization(
    raw: unknown,
    expected: { nonce: string; providerAlias: string },
  ): Promise<{
    tokenSet: SsoTokenSet;
    subject: string;
    sessionId?: string;
  }> {
    const parsed = AuthorizationTokenResponseSchema.safeParse(raw);
    if (!parsed.success || !PROVIDER_ALIAS_RE.test(expected.providerAlias)) {
      throw new OidcProtocolError("oidc_token_invalid", "invalid");
    }
    const value = parsed.data;
    const accessClaims = await verifyAccessToken(
      value.access_token,
      expected.providerAlias,
    );
    const idClaims = await verifyIdToken(value.id_token, value.access_token, {
      nonce: expected.nonce,
      nonceRequired: true,
      subject: accessClaims.sub ?? "",
    });
    const sessionId = consistentSessionId(accessClaims.sid, idClaims.sid);
    return {
      subject: accessClaims.sub ?? "",
      ...(sessionId ? { sessionId } : {}),
      tokenSet: {
        accessToken: value.access_token,
        accessTokenExpiresAt: boundedExpiration(
          now(),
          value.expires_in,
          accessClaims.exp,
        ),
        refreshToken: value.refresh_token,
        refreshTokenExpiresAt: now() + value.refresh_expires_in,
        idToken: value.id_token,
      },
    };
  }

  return {
    async checkReachability() {
      const signal = AbortSignal.timeout(upstreamTimeoutMs);
      try {
        const response = await fetchImpl(endpoints.jwks, {
          method: "GET",
          headers: { Accept: "application/json, application/jwk-set+json" },
          cache: "no-store",
          redirect: "manual",
          signal,
        });
        if (!response.ok) throw new Error("JWKS unavailable");
        const payload = await readBoundedJson(response, {
          maxBytes: maxResponseBytes,
          signal,
        });
        if (
          !payload ||
          typeof payload !== "object" ||
          !Array.isArray((payload as { keys?: unknown }).keys)
        ) {
          throw new Error("JWKS invalid");
        }
      } catch {
        throw new OidcProtocolError("oidc_upstream_unavailable", "transient");
      }
    },

    async beginAuthorization(repository, input) {
      if (
        !PROVIDER_ALIAS_RE.test(input.providerAlias) ||
        !isSafeRedirectPath(input.redirectPath)
      ) {
        throw new OidcProtocolError(
          "oidc_authorization_input_invalid",
          "invalid",
        );
      }
      const codeVerifier = randomBytes(64).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const issued = await repository.createLoginTransaction(
        {
          providerAlias: input.providerAlias,
          redirectPath: input.redirectPath,
          clientId: config.clientId,
          codeVerifier,
          nonce,
        },
        LOGIN_TRANSACTION_TTL_MS,
      );
      const location = new URL(endpoints.authorization);
      location.searchParams.set("client_id", config.clientId);
      location.searchParams.set("redirect_uri", redirectUri);
      location.searchParams.set("response_type", "code");
      location.searchParams.set("response_mode", "query");
      location.searchParams.set("scope", "openid");
      location.searchParams.set("state", issued.state);
      location.searchParams.set("nonce", nonce);
      location.searchParams.set(
        "code_challenge",
        createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
      );
      location.searchParams.set("code_challenge_method", "S256");
      location.searchParams.set("kc_idp_hint", input.providerAlias);
      return {
        location: location.toString(),
        browserBinding: issued.browserBinding,
      };
    },

    async completeAuthorization(repository, input) {
      if (
        !input.code ||
        input.code.length > 4_096 ||
        !OPAQUE_VALUE_RE.test(input.state) ||
        !OPAQUE_VALUE_RE.test(input.browserBinding)
      ) {
        throw new OidcProtocolError("oidc_state_invalid", "invalid");
      }
      const transaction = await repository.consumeLoginTransaction(
        input.state,
        input.browserBinding,
      );
      if (!transaction || transaction.clientId !== config.clientId) {
        throw new OidcProtocolError("oidc_state_invalid", "invalid");
      }
      const raw = await requestTokens(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          redirect_uri: redirectUri,
          code: input.code,
          code_verifier: transaction.codeVerifier,
        }),
        "authorization",
      );
      const authorization = await validateAuthorization(raw, {
        nonce: transaction.nonce,
        providerAlias: transaction.providerAlias,
      });
      return {
        providerAlias: transaction.providerAlias,
        redirectPath: transaction.redirectPath,
        oidcNonce: transaction.nonce,
        subject: authorization.subject,
        ...(authorization.sessionId
          ? { sessionId: authorization.sessionId }
          : {}),
        tokenSet: authorization.tokenSet,
      };
    },

    validateAuthorizationTokenSet,

    async refresh(refreshToken, expected) {
      const raw = await requestTokens(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: config.clientId,
          refresh_token: refreshToken,
        }),
        "refresh",
      );
      const parsed = RefreshTokenResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new OidcProtocolError("oidc_token_response_invalid", "invalid");
      }
      const value = parsed.data;
      const accessClaims = await verifyAccessToken(
        value.access_token,
        expected.providerAlias,
      );
      if (expected.subject && accessClaims.sub !== expected.subject) {
        throw new OidcProtocolError("oidc_token_invalid", "invalid");
      }
      let idClaims: JWTPayload | undefined;
      if (value.id_token) {
        idClaims = await verifyIdToken(value.id_token, value.access_token, {
          nonce: expected.nonce,
          nonceRequired: false,
          subject: accessClaims.sub ?? "",
        });
      }
      const sessionId = consistentSessionId(accessClaims.sid, idClaims?.sid);
      if (expected.sessionId && sessionId && sessionId !== expected.sessionId) {
        throw new OidcProtocolError("oidc_token_invalid", "invalid");
      }
      return {
        accessToken: value.access_token,
        accessTokenExpiresAt: boundedExpiration(
          now(),
          value.expires_in,
          accessClaims.exp,
        ),
        refreshToken: value.refresh_token ?? refreshToken,
        ...(value.refresh_expires_in
          ? { refreshTokenExpiresAt: now() + value.refresh_expires_in }
          : {}),
        ...(value.id_token
          ? { idToken: value.id_token }
          : expected.idToken
            ? { idToken: expected.idToken }
            : {}),
      };
    },

    async revokeRefreshToken(refreshToken) {
      let response: Response;
      try {
        response = await fetchImpl(endpoints.revocation, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: config.clientId,
            token: refreshToken,
            token_type_hint: "refresh_token",
          }),
          cache: "no-store",
          redirect: "manual",
          signal: AbortSignal.timeout(upstreamTimeoutMs),
        });
      } catch {
        throw new OidcProtocolError("oidc_upstream_unavailable", "transient");
      }
      if (!response.ok) {
        throw new OidcProtocolError("oidc_revocation_failed", "transient");
      }
    },

    async verifyBackchannelLogoutToken(logoutToken) {
      assertPinnedHeader(logoutToken, { requireJwtTyp: false });
      try {
        const { payload } = await jwtVerify(logoutToken, jwks, {
          algorithms: ["RS256"],
          issuer: config.issuer,
          audience: config.clientId,
          currentDate: new Date(now() * 1_000),
          clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,
        });
        const issuedAt = payload.iat;
        const jti = boundedClaim(payload.jti);
        const subject = optionalBoundedClaim(payload.sub);
        const sessionId = optionalBoundedClaim(payload.sid);
        const events = payload.events;
        const event =
          events && typeof events === "object" && !Array.isArray(events)
            ? (events as Record<string, unknown>)[BACKCHANNEL_LOGOUT_EVENT]
            : undefined;
        const exactAudience =
          payload.aud === config.clientId ||
          (Array.isArray(payload.aud) &&
            payload.aud.length === 1 &&
            payload.aud[0] === config.clientId);
        if (
          payload.iss !== config.issuer ||
          !exactAudience ||
          !Number.isSafeInteger(issuedAt) ||
          (issuedAt ?? 0) > now() + OIDC_CLOCK_TOLERANCE_SECONDS ||
          now() - (issuedAt ?? 0) > BACKCHANNEL_LOGOUT_MAX_AGE_SECONDS ||
          !jti ||
          (!subject && !sessionId) ||
          payload.nonce !== undefined ||
          !event ||
          typeof event !== "object" ||
          Array.isArray(event)
        ) {
          throw new Error("claim mismatch");
        }
        return {
          jti,
          ...(subject ? { subject } : {}),
          ...(sessionId ? { sessionId } : {}),
          replayTtlMs:
            (BACKCHANNEL_LOGOUT_MAX_AGE_SECONDS +
              OIDC_CLOCK_TOLERANCE_SECONDS) *
            1_000,
        };
      } catch (error) {
        throw tokenVerificationError(error, usesRemoteJwks);
      }
    },

    logoutLocation() {
      return buildKeycloakLogoutLocation(config);
    },
  };
}

export function buildKeycloakLogoutLocation(
  config: Pick<KeycloakOidcConfig, "issuer" | "clientId" | "publicOrigin">,
): string {
  const location = new URL(
    `${config.issuer.replace(/\/$/u, "")}/protocol/openid-connect/logout`,
  );
  location.searchParams.set("client_id", config.clientId);
  location.searchParams.set(
    "post_logout_redirect_uri",
    `${config.publicOrigin}/login`,
  );
  return location.toString();
}

function tokenVerificationError(
  error: unknown,
  usesRemoteJwks: boolean,
): OidcProtocolError {
  if (
    error instanceof joseErrors.JWKSTimeout ||
    (error instanceof joseErrors.JOSEError &&
      error.code === "ERR_JOSE_GENERIC") ||
    (usesRemoteJwks && error instanceof TypeError)
  ) {
    return new OidcProtocolError("oidc_upstream_unavailable", "transient");
  }
  return new OidcProtocolError("oidc_token_invalid", "invalid");
}

function isTransientUpstreamStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function readBoundedJson(
  response: Response,
  options: { maxBytes: number; signal: AbortSignal },
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    throw new OidcResponseLimitError();
  }

  const reader = response.body?.getReader();
  if (!reader) throw new SyntaxError("empty response");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await readWithDeadline(reader, options.signal);
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > options.maxBytes) throw new OidcResponseLimitError();
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
}

function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) return Promise.reject(new OidcResponseDeadlineError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new OidcResponseDeadlineError());
    signal.addEventListener("abort", onAbort, { once: true });
    void reader
      .read()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

function assertPinnedHeader(
  token: string,
  options: { requireJwtTyp?: boolean } = {},
): void {
  try {
    const header = decodeProtectedHeader(token);
    if (
      header.alg !== "RS256" ||
      (options.requireJwtTyp !== false && header.typ !== "JWT") ||
      typeof header.kid !== "string" ||
      header.kid.length === 0 ||
      header.kid.length > 255 ||
      "jku" in header ||
      "jwk" in header ||
      "x5u" in header ||
      "x5c" in header
    ) {
      throw new Error("header mismatch");
    }
  } catch {
    throw new OidcProtocolError("oidc_token_invalid", "invalid");
  }
}

function boundedClaim(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048
    ? value
    : null;
}

function optionalBoundedClaim(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const bounded = boundedClaim(value);
  if (!bounded) throw new Error("claim mismatch");
  return bounded;
}

function keycloakEndpoints(issuer: string, transportUrl: string) {
  const canonicalRoot = issuer.replace(/\/$/u, "");
  const transportRoot = transportUrl.replace(/\/$/u, "");
  return {
    authorization: `${canonicalRoot}/protocol/openid-connect/auth`,
    token: `${transportRoot}/protocol/openid-connect/token`,
    jwks: `${transportRoot}/protocol/openid-connect/certs`,
    revocation: `${transportRoot}/protocol/openid-connect/revoke`,
    logout: `${canonicalRoot}/protocol/openid-connect/logout`,
  };
}

function accessTokenHash(accessToken: string): string {
  return createHash("sha256")
    .update(accessToken, "ascii")
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

function consistentSessionId(...claims: unknown[]): string | undefined {
  const values: string[] = [];
  for (const claim of claims) {
    if (claim === undefined) continue;
    if (
      typeof claim !== "string" ||
      claim.length === 0 ||
      claim.length > 2_048
    ) {
      throw new OidcProtocolError("oidc_token_invalid", "invalid");
    }
    values.push(claim);
  }
  if (values.length === 0) return undefined;
  if (values.some((value) => value !== values[0])) {
    throw new OidcProtocolError("oidc_token_invalid", "invalid");
  }
  return values[0];
}

function boundedExpiration(
  nowSeconds: number,
  expiresIn: number,
  jwtExpiration: number | undefined,
): number {
  if (!jwtExpiration || jwtExpiration <= nowSeconds) {
    throw new OidcProtocolError("oidc_token_invalid", "invalid");
  }
  return Math.min(nowSeconds + expiresIn, jwtExpiration);
}

function isSafeRedirectPath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    containsControlCharacter(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value, "https://reef.invalid");
    return (
      parsed.origin === "https://reef.invalid" &&
      parsed.hash === "" &&
      value.length <= 2_048
    );
  } catch {
    return false;
  }
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
