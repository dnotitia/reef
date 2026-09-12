import { AkbApiError, AuthError, isAkbAccountErrorCode } from "@reef/core";
import { AuthV2OidcProtocolError } from "./oidcProtocol";
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
      if (error.status >= 500) {
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

  try {
    const current = await runtime.store.resolve(handle);
    if (!current) throw new AuthV2RouteSessionError("auth_v2_session_expired");
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
          absolute_expires_at: Math.min(
            current.absolute_expires_at,
            error.custody.refreshTokenExpiresAt,
          ),
        });
        if (preserved) {
          throw new AuthV2RouteSessionError("auth_v2_account_unavailable", 503);
        }
      }
      throw error;
    }

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
      if (latest && latest.access_token_expires_at > runtime.now())
        return latest;
      throw new AuthV2RouteSessionError("auth_v2_session_expired");
    }
    return replacement;
  } finally {
    await runtime.refreshLock.release(handle, owner);
  }
}
