import { randomUUID } from "node:crypto";
import type { CompletedAuthorization, KeycloakOidcClient } from "./oidcClient";
import { OidcProtocolError } from "./oidcClient";
import {
  SsoSessionRecordError,
  type EncryptedSessionRepository,
  type SsoSessionData,
  type SsoTokenSet,
  type VersionedSsoSession,
} from "./sessionRepository";

const ACCESS_REFRESH_SKEW_SECONDS = 30;
// Covers the bounded Redis read/write plus token and fixed-JWKS calls with
// margin, so a second request cannot rotate the same refresh token mid-flight.
const REFRESH_LOCK_TTL_MS = 30_000;
const DEFAULT_REFRESH_POLL_MS = 25;
const DEFAULT_REFRESH_WAIT_MS = 2_000;
const MAX_SESSION_TTL_SECONDS = 24 * 60 * 60;

export class SsoSessionError extends Error {
  constructor(
    readonly code: string,
    readonly kind: "expired" | "transient" | "invalid",
  ) {
    super(code);
    this.name = "SsoSessionError";
  }
}

export interface SsoSessionService {
  createSession(completed: CompletedAuthorization): Promise<string>;
  resolveAccessToken(handle: string): Promise<string>;
  invalidate(handle: string): Promise<void>;
  logout(handle: string): Promise<string>;
}

export function createSsoSessionService(options: {
  repository: EncryptedSessionRepository;
  oidc: KeycloakOidcClient;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  refreshPollMs?: number;
  refreshWaitMs?: number;
}): SsoSessionService {
  const { repository, oidc } = options;
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const refreshPollMs = options.refreshPollMs ?? DEFAULT_REFRESH_POLL_MS;
  const refreshWaitMs = options.refreshWaitMs ?? DEFAULT_REFRESH_WAIT_MS;

  async function deleteSessionBestEffort(handle: string): Promise<void> {
    try {
      await repository.deleteSession(handle);
    } catch {
      // The browser carrier is still invalidated by the caller. Never replace a
      // bounded auth result with Redis connection details.
    }
  }

  async function read(handle: string): Promise<VersionedSsoSession> {
    let session: VersionedSsoSession | null;
    try {
      session = await repository.readSession(handle);
    } catch (error) {
      if (error instanceof SsoSessionRecordError) {
        await deleteSessionBestEffort(handle);
        throw new SsoSessionError("sso_session_invalid", "invalid");
      }
      throw new SsoSessionError("sso_session_store_unavailable", "transient");
    }
    if (!session) {
      throw new SsoSessionError("sso_session_expired", "expired");
    }
    return session;
  }

  function accessIsUsable(tokenSet: SsoTokenSet): boolean {
    return tokenSet.accessTokenExpiresAt > now();
  }

  function accessNeedsRefresh(tokenSet: SsoTokenSet): boolean {
    return tokenSet.accessTokenExpiresAt <= now() + ACCESS_REFRESH_SKEW_SECONDS;
  }

  function ttlMs(tokenSet: SsoTokenSet): number {
    const refreshExpiration = tokenSet.refreshTokenExpiresAt;
    if (!refreshExpiration) return MAX_SESSION_TTL_SECONDS * 1_000;
    return (
      Math.min(
        MAX_SESSION_TTL_SECONDS,
        Math.max(1, refreshExpiration - now()),
      ) * 1_000
    );
  }

  async function waitForRefreshWinner(
    handle: string,
    baseline: VersionedSsoSession,
  ): Promise<string> {
    const attempts = Math.max(1, Math.ceil(refreshWaitMs / refreshPollMs));
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await sleep(refreshPollMs);
      let current: VersionedSsoSession;
      try {
        current = await read(handle);
      } catch (error) {
        if (
          error instanceof SsoSessionError &&
          error.kind === "transient" &&
          accessIsUsable(baseline.tokenSet)
        ) {
          return baseline.tokenSet.accessToken;
        }
        throw error;
      }
      if (
        current.revision !== baseline.revision &&
        accessIsUsable(current.tokenSet)
      ) {
        return current.tokenSet.accessToken;
      }
    }
    if (accessIsUsable(baseline.tokenSet)) {
      return baseline.tokenSet.accessToken;
    }
    throw new SsoSessionError("sso_refresh_in_progress", "transient");
  }

  async function refreshAccessToken(
    handle: string,
    baseline: VersionedSsoSession,
  ): Promise<string> {
    const owner = randomUUID();
    let acquired: boolean;
    try {
      acquired = await repository.acquireRefreshLock(
        handle,
        owner,
        REFRESH_LOCK_TTL_MS,
      );
    } catch {
      if (accessIsUsable(baseline.tokenSet)) {
        return baseline.tokenSet.accessToken;
      }
      throw new SsoSessionError("sso_session_store_unavailable", "transient");
    }
    if (!acquired) return waitForRefreshWinner(handle, baseline);

    try {
      let current: VersionedSsoSession;
      try {
        current = await read(handle);
      } catch (error) {
        if (
          error instanceof SsoSessionError &&
          error.kind === "transient" &&
          accessIsUsable(baseline.tokenSet)
        ) {
          return baseline.tokenSet.accessToken;
        }
        throw error;
      }
      if (!accessNeedsRefresh(current.tokenSet)) {
        return current.tokenSet.accessToken;
      }
      const refreshToken = current.tokenSet.refreshToken;
      if (
        !refreshToken ||
        (current.tokenSet.refreshTokenExpiresAt !== undefined &&
          current.tokenSet.refreshTokenExpiresAt <= now())
      ) {
        await deleteSessionBestEffort(handle);
        throw new SsoSessionError("sso_session_expired", "expired");
      }

      let refreshed: SsoTokenSet;
      try {
        refreshed = await oidc.refresh(refreshToken, {
          nonce: current.oidcNonce,
          providerAlias: current.providerAlias,
          idToken: current.tokenSet.idToken,
        });
      } catch (error) {
        if (error instanceof OidcProtocolError && error.kind === "transient") {
          if (accessIsUsable(current.tokenSet)) {
            return current.tokenSet.accessToken;
          }
          throw new SsoSessionError("sso_upstream_unavailable", "transient");
        }
        await deleteSessionBestEffort(handle);
        throw new SsoSessionError("sso_session_expired", "expired");
      }

      const rotatedTokenSet: SsoTokenSet = {
        ...refreshed,
        ...(refreshed.refreshTokenExpiresAt
          ? {}
          : current.tokenSet.refreshTokenExpiresAt
            ? {
                refreshTokenExpiresAt: current.tokenSet.refreshTokenExpiresAt,
              }
            : {}),
      };
      const next: SsoSessionData = {
        providerAlias: current.providerAlias,
        oidcNonce: current.oidcNonce,
        tokenSet: rotatedTokenSet,
      };
      let replaced: boolean;
      try {
        replaced = await repository.replaceSession(
          handle,
          current.revision,
          next,
          ttlMs(rotatedTokenSet),
        );
      } catch {
        throw new SsoSessionError("sso_session_store_unavailable", "transient");
      }
      if (replaced) return rotatedTokenSet.accessToken;

      const winner = await read(handle);
      if (accessIsUsable(winner.tokenSet)) return winner.tokenSet.accessToken;
      throw new SsoSessionError("sso_refresh_conflict", "transient");
    } finally {
      try {
        await repository.releaseRefreshLock(handle, owner);
      } catch {
        // The lock has a hard TTL. A release outage must not replace a bounded
        // refresh result or expose store details to the request boundary.
      }
    }
  }

  return {
    createSession(completed) {
      return repository.createSession(
        {
          providerAlias: completed.providerAlias,
          oidcNonce: completed.oidcNonce,
          tokenSet: completed.tokenSet,
        },
        ttlMs(completed.tokenSet),
      );
    },

    async resolveAccessToken(handle) {
      const session = await read(handle);
      return accessNeedsRefresh(session.tokenSet)
        ? refreshAccessToken(handle, session)
        : session.tokenSet.accessToken;
    },

    invalidate(handle) {
      return repository.deleteSession(handle);
    },

    async logout(handle) {
      let session: VersionedSsoSession | null = null;
      try {
        session = await repository.readSession(handle);
      } catch {
        // A corrupt record is still removed locally below.
      }
      await repository.deleteSession(handle);
      const refreshToken = session?.tokenSet.refreshToken;
      if (refreshToken) {
        try {
          await oidc.revokeRefreshToken(refreshToken);
        } catch {
          // Revocation is best-effort after the local session is gone.
        }
      }
      return oidc.logoutLocation();
    },
  };
}
