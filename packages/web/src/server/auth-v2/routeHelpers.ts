import {
  type AkbAuthV2AccountDenialCode,
  type AkbUser,
  isAkbAccountErrorCode,
} from "@reef/core";
import {
  buildClearedAuthInvalidationCookie,
  buildClearedAuthCookies,
} from "@/lib/akb/sessionCookie";
import {
  AUTH_V2_SESSION_COOKIE,
  buildAuthV2SessionCookie,
  buildClearedAuthV2SessionCookie,
  buildClearedAuthV2StateCookie,
  readAuthV2Cookies,
} from "./cookie";
import type { AuthV2OidcProtocolError } from "./oidcProtocol";
import type { AuthV2RouteRuntime } from "./runtime";
import {
  AuthV2SessionStoreError,
  type AuthV2SessionRecord,
} from "./sessionStore";

export type AuthV2RouteFailureCode =
  | "auth_v2_session_missing"
  | "auth_v2_session_invalid"
  | "auth_v2_session_expired"
  | "auth_v2_refresh_busy"
  | "auth_v2_account_unavailable"
  | AkbAuthV2AccountDenialCode;

export class AuthV2RouteSessionError extends Error {
  constructor(
    readonly code: AuthV2RouteFailureCode,
    readonly status: 401 | 409 | 503 = 401,
  ) {
    super(code);
    this.name = "AuthV2RouteSessionError";
  }
}

export function sessionHandle(request: Request): string | null {
  const value = readAuthV2Cookies(request)[AUTH_V2_SESSION_COOKIE];
  return value && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

export async function resolveSession(
  runtime: AuthV2RouteRuntime,
  handle: string | null,
): Promise<AuthV2SessionRecord> {
  if (!handle) {
    throw new AuthV2RouteSessionError("auth_v2_session_missing");
  }
  const record = await runtime.store.resolve(handle);
  if (!record) {
    throw new AuthV2RouteSessionError("auth_v2_session_expired");
  }
  return record;
}

export async function refreshIfNeeded(
  runtime: AuthV2RouteRuntime,
  handle: string,
  record: AuthV2SessionRecord,
): Promise<AuthV2SessionRecord> {
  if (record.access_token_expires_at > runtime.now()) return record;

  const owner = await runtime.refreshLock.acquire(handle);
  if (!owner) {
    const current = await runtime.store.resolve(handle);
    if (current && current.access_token_expires_at > runtime.now()) {
      return current;
    }
    throw new AuthV2RouteSessionError("auth_v2_refresh_busy", 409);
  }

  try {
    const current = await runtime.store.resolve(handle);
    if (!current) {
      throw new AuthV2RouteSessionError("auth_v2_session_expired");
    }
    if (current.access_token_expires_at > runtime.now()) return current;

    const protocol = runtime.protocolFor(current.provider_alias);
    const next = await protocol.refresh({
      refreshToken: current.refresh_token ?? "",
      providerAlias: current.provider_alias,
      subject: current.subject,
      sessionId: current.session_id ?? undefined,
      previousIdToken: current.id_token ?? undefined,
    });
    const replacement: AuthV2SessionRecord = {
      ...current,
      access_token: next.accessToken,
      refresh_token: next.refreshToken,
      id_token: next.idToken,
      access_token_expires_at: next.accessTokenExpiresAt,
      absolute_expires_at: Math.min(
        current.absolute_expires_at,
        next.refreshTokenExpiresAt,
      ),
    };
    const replaced = await runtime.store.replace(handle, current, replacement);
    if (!replaced) {
      const latest = await runtime.store.resolve(handle);
      if (latest && latest.access_token_expires_at > runtime.now()) {
        return latest;
      }
      throw new AuthV2RouteSessionError("auth_v2_session_invalid");
    }
    return replacement;
  } finally {
    await runtime.refreshLock.release(handle, owner);
  }
}

export async function validateSessionAccount(
  runtime: AuthV2RouteRuntime,
  record: AuthV2SessionRecord,
): Promise<AkbUser> {
  const result = await runtime.accountValidator({
    accessToken: record.access_token,
    subject: record.subject,
    issuer: runtime.contract.canonical_issuer,
    providerAlias: record.provider_alias,
  });
  if (result.outcome === "accepted") return result.account;
  if (result.outcome === "denied") {
    throw new AuthV2RouteSessionError(result.code);
  }
  throw new AuthV2RouteSessionError("auth_v2_account_unavailable", 503);
}

export function isAccountDenial(
  error: unknown,
): error is AuthV2RouteSessionError & { code: AkbAuthV2AccountDenialCode } {
  return (
    error instanceof AuthV2RouteSessionError &&
    isAkbAccountErrorCode(error.code)
  );
}

export function responseForRouteFailure(
  error: unknown,
  options: { clearSession?: string; status?: number } = {},
): Response {
  const code = routeFailureCode(error);
  const status = options.status ?? routeFailureStatus(error);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  });
  const shouldClear =
    options.clearSession !== undefined || isInvalidatingSessionError(error);
  if (shouldClear) {
    for (const cookie of buildClearedAuthCookies()) {
      headers.append("Set-Cookie", cookie);
    }
    headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
    headers.append("Set-Cookie", buildClearedAuthV2SessionCookie());
    headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
    headers.set("X-Reef-Auth-Invalidated", "1");
  }
  return Response.json({ error: code }, { status, headers });
}

function isInvalidatingSessionError(error: unknown): boolean {
  if (error instanceof AuthV2SessionStoreError) return true;
  if (error instanceof AuthV2RouteSessionError) {
    return (
      error.code === "auth_v2_session_missing" ||
      error.code === "auth_v2_session_invalid" ||
      error.code === "auth_v2_session_expired" ||
      isAkbAccountErrorCode(error.code)
    );
  }
  return isOidcError(error) && isSessionInvalidatingOidcCode(error.code);
}

/** Route handlers revoke and clear the browser carrier for cryptographic or
 * refresh failures; a transient upstream outage remains retryable. */
export function shouldRevokeSession(error: unknown): boolean {
  return isInvalidatingSessionError(error);
}

function routeFailureStatus(error: unknown): 401 | 409 | 503 {
  if (error instanceof AuthV2SessionStoreError) return 401;
  if (error instanceof AuthV2RouteSessionError) return error.status;
  if (isOidcError(error) && isSessionInvalidatingOidcCode(error.code)) {
    return 401;
  }
  return 503;
}

function isSessionInvalidatingOidcCode(code: string): boolean {
  return (
    code === "auth_v2_refresh_rejected" ||
    code === "auth_v2_token_response_invalid" ||
    code === "auth_v2_id_token_invalid"
  );
}

export function responseWithAuthV2Session(
  account: AkbUser,
  handle: string,
  record: AuthV2SessionRecord,
): Response {
  const maxAge = Math.max(
    0,
    record.absolute_expires_at - Math.floor(Date.now() / 1_000),
  );
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append("Set-Cookie", buildAuthV2SessionCookie(handle, maxAge));
  return Response.json({ user: account }, { status: 200, headers });
}

export function clearAuthV2Headers(headers = new Headers()): Headers {
  for (const cookie of buildClearedAuthCookies()) {
    headers.append("Set-Cookie", cookie);
  }
  headers.append("Set-Cookie", buildClearedAuthInvalidationCookie());
  headers.append("Set-Cookie", buildClearedAuthV2SessionCookie());
  headers.append("Set-Cookie", buildClearedAuthV2StateCookie());
  return headers;
}

export function routeFailureCode(
  error: unknown,
): AuthV2RouteFailureCode | "auth_v2_route_failed" {
  if (error instanceof AuthV2SessionStoreError) {
    return "auth_v2_session_invalid";
  }
  if (error instanceof AuthV2RouteSessionError) return error.code;
  if (isOidcError(error)) {
    if (isSessionInvalidatingOidcCode(error.code)) {
      return "auth_v2_session_invalid";
    }
    if (error.code === "auth_v2_upstream_unavailable") {
      return "auth_v2_account_unavailable";
    }
  }
  return "auth_v2_route_failed";
}

function isOidcError(error: unknown): error is AuthV2OidcProtocolError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AuthV2OidcProtocolError" &&
    "code" in error
  );
}
