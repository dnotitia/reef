import { AkbApiError, AuthError, isAkbAccountErrorCode } from "@reef/core";
import { AuthV2OidcProtocolError } from "./oidcProtocol";
import { AuthV2RefreshLockError } from "./refreshLock";
import { AuthV2RedisBackendError } from "./redisBackend";
import {
  AuthV2RouteRuntimeError,
  getAuthV2RouteRuntime,
  type AuthV2RouteRuntime,
} from "./runtime";
import {
  AuthV2SessionStoreError,
  type AuthV2SessionRecord,
} from "./sessionStore";

export type AuthV2RouteFailureCode =
  | "auth_v2_session_expired"
  | "auth_v2_refresh_busy"
  | "auth_v2_account_unavailable"
  | "membership_required"
  | "account_suspended"
  | "identity_conflict";

export class AuthV2RouteSessionError extends Error {
  constructor(
    readonly code: AuthV2RouteFailureCode,
    readonly status: 401 | 409 | 503 = 401,
  ) {
    super(code);
    this.name = "AuthV2RouteSessionError";
  }
}

/** Resolve the current SSO access token at the start of each AKB operation. */
export async function resolveAuthV2Credential(handle: string): Promise<string> {
  let runtime: Awaited<ReturnType<typeof getAuthV2RouteRuntime>> | undefined;
  try {
    runtime = await getAuthV2RouteRuntime();
    let record = await resolveSession(runtime, handle);
    record = await refreshIfNeeded(runtime, handle, record);
    return record.access_token;
  } catch (error) {
    if (error instanceof AuthV2RouteSessionError) {
      if (isAkbAccountErrorCode(error.code)) {
        throw new AuthError({ origin: "akb", code: error.code, status: 401 });
      }
      if (error.status === 409 || error.status >= 500) {
        throw new AkbApiError({ status: error.status, message: error.code });
      }
      throw new AuthError({
        origin: "akb",
        status: error.status,
        message: error.code,
      });
    }
    if (error instanceof AuthV2SessionStoreError) {
      throw new AuthError({
        origin: "akb",
        status: 401,
        message: "auth_v2_session_invalid",
      });
    }
    if (
      error instanceof AuthV2RedisBackendError ||
      error instanceof AuthV2RefreshLockError
    ) {
      throw new AkbApiError({ status: 503, message: "auth_v2_unavailable" });
    }
    if (error instanceof AuthV2OidcProtocolError) {
      if (error.kind === "unavailable") {
        throw new AkbApiError({ status: 503, message: error.code });
      }
      await revokeExpiredSession(runtime, handle);
      throw new AuthError({
        origin: "akb",
        status: 401,
        message: "auth_v2_session_invalid",
      });
    }
    if (error instanceof AuthV2RouteRuntimeError) {
      throw new AkbApiError({ status: 503, message: error.code });
    }
    throw error;
  } finally {
    await runtime?.close();
  }
}

export async function resolveSession(
  runtime: AuthV2RouteRuntime,
  handle: string | null,
): Promise<AuthV2SessionRecord> {
  if (!handle) throw new AuthV2RouteSessionError("auth_v2_session_expired");
  const record = await runtime.store.resolve(handle);
  if (!record) throw new AuthV2RouteSessionError("auth_v2_session_expired");
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
    if (current && current.access_token_expires_at > runtime.now())
      return current;
    throw new AuthV2RouteSessionError("auth_v2_refresh_busy", 409);
  }

  let refreshFailed = false;
  let refreshFailure: unknown;
  let result: AuthV2SessionRecord | undefined;
  try {
    result = await rotateAuthV2Session(runtime, handle);
  } catch (error) {
    refreshFailed = true;
    refreshFailure = error;
  }

  try {
    await runtime.refreshLock.release(handle, owner);
  } catch (error) {
    // Preserve a definitive refresh/session disposition. A lock cleanup
    // outage must not turn a rejected refresh into an apparently retryable
    // success or hide the session-expiry response.
    if (!refreshFailed) {
      refreshFailed = true;
      refreshFailure = error;
    }
  }

  if (refreshFailed) throw refreshFailure;
  if (!result) throw new AuthV2RouteSessionError("auth_v2_session_expired");
  return result;
}

async function rotateAuthV2Session(
  runtime: AuthV2RouteRuntime,
  handle: string,
): Promise<AuthV2SessionRecord> {
  const current = await runtime.store.resolve(handle);
  if (!current) throw new AuthV2RouteSessionError("auth_v2_session_expired");
  if (
    current.refresh_token_expires_at <= runtime.now() ||
    current.absolute_expires_at <= runtime.now()
  ) {
    throw new AuthV2RouteSessionError("auth_v2_session_expired");
  }
  if (current.access_token_expires_at > runtime.now()) return current;

  const protocol = runtime.protocolFor(current.provider_alias);
  let next: Awaited<ReturnType<typeof protocol.refresh>>;
  try {
    next = await protocol.refresh({
      refreshToken: current.refresh_token,
      providerAlias: current.provider_alias,
      subject: current.subject,
      sessionId: current.session_id ?? undefined,
      previousIdToken: current.id_token,
      previousRefreshTokenExpiresAt: current.refresh_token_expires_at,
    });
  } catch (error) {
    if (
      error instanceof AuthV2OidcProtocolError &&
      error.code === "auth_v2_keyset_unavailable" &&
      error.custody
    ) {
      const preserved = await runtime.store.replace(handle, current, {
        ...current,
        refresh_token: error.custody.refreshToken,
        refresh_token_expires_at: error.custody.refreshTokenExpiresAt,
      });
      if (!preserved) {
        throw new AuthV2RouteSessionError("auth_v2_refresh_busy", 409);
      }
      throw new AuthV2RouteSessionError("auth_v2_account_unavailable", 503);
    }
    throw error;
  }

  if (
    next.refreshTokenExpiresAt <= runtime.now() ||
    current.absolute_expires_at <= runtime.now()
  ) {
    throw new AuthV2RouteSessionError("auth_v2_session_expired");
  }

  const replacement: AuthV2SessionRecord = {
    ...current,
    access_token: next.accessToken,
    refresh_token: next.refreshToken,
    id_token: next.idToken,
    access_token_expires_at: next.accessTokenExpiresAt,
    refresh_token_expires_at: next.refreshTokenExpiresAt,
    absolute_expires_at: current.absolute_expires_at,
  };
  const replaced = await runtime.store.replace(handle, current, replacement);
  if (!replaced) {
    if (
      current.refresh_token_expires_at <= runtime.now() ||
      current.absolute_expires_at <= runtime.now()
    ) {
      throw new AuthV2RouteSessionError("auth_v2_session_expired");
    }
    const latest = await runtime.store.resolve(handle);
    if (latest && latest.access_token_expires_at > runtime.now()) return latest;
    throw new AuthV2RouteSessionError("auth_v2_refresh_busy", 409);
  }
  return replacement;
}

async function revokeExpiredSession(
  runtime: AuthV2RouteRuntime | undefined,
  handle: string,
): Promise<void> {
  if (!runtime) return;
  try {
    await runtime.store.revoke(handle);
  } catch {
    // The refresh rejection is authoritative. Best-effort revocation must not
    // turn a confirmed expiry into a retryable response or leak the handle.
  }
}
