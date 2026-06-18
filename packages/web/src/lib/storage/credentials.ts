import Dexie from "dexie";
import { clearAuthScopedClientCache } from "./clientCache";
import { db } from "./db";

const GITHUB_TOKEN_KEY = "github_token";

/**
 * Returns `true` when the error represents a Dexie instance whose underlying
 * IndexedDB was closed/deleted by the user (devtools → Clear storage). Callers
 * can then surface a neutral "not configured" state instead of crashing.
 */
function isDexieClosedError(err: unknown): boolean {
  return (
    err instanceof Dexie.DatabaseClosedError ||
    err instanceof Dexie.InvalidStateError ||
    // AbortError is thrown by some Dexie 4.x paths when the backing store is gone
    (err instanceof Error && err.name === "AbortError")
  );
}

/**
 * Reads the GitHub token from IndexedDB.
 * Returns undefined if no token is stored or the database has been cleared.
 */
export async function getGitHubToken(): Promise<string | undefined> {
  try {
    const entry = await db.credentials
      .where("key")
      .equals(GITHUB_TOKEN_KEY)
      .first();
    return entry?.value;
  } catch (err) {
    if (isDexieClosedError(err)) {
      return undefined;
    }
    // Re-throw unexpected errors
    throw err;
  }
}

/**
 * Stores (or replaces) the GitHub token in IndexedDB.
 * Returns `false` when the underlying database is unavailable (e.g. the user
 * wiped IndexedDB in devtools mid-session); otherwise `true`.
 */
export async function setGitHubToken(token: string): Promise<boolean> {
  try {
    const existing = await db.credentials
      .where("key")
      .equals(GITHUB_TOKEN_KEY)
      .first();
    // Idempotent save (e.g. OAuth callback fired twice with the same token):
    // skip both the IndexedDB write and the auth-scoped cache wipe so we
    // don't pay a refetch on a no-op. Cache invalidation fires when
    // the credential actually changes — including the first-time set
    // (existing === undefined) so any leftover cache from a prior session
    // is cleaned up.
    if (existing?.value === token) {
      return true;
    }
    if (existing?.id !== undefined) {
      await db.credentials.put({
        id: existing.id,
        key: GITHUB_TOKEN_KEY,
        value: token,
      });
    } else {
      await db.credentials.add({ key: GITHUB_TOKEN_KEY, value: token });
    }
    clearAuthScopedClientCache();
    return true;
  } catch (err) {
    if (isDexieClosedError(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Removes the GitHub token from IndexedDB.
 * Returns `false` when the underlying database is unavailable; otherwise `true`.
 */
export async function clearGitHubToken(): Promise<boolean> {
  try {
    await db.credentials.where("key").equals(GITHUB_TOKEN_KEY).delete();
    // Disconnect invalidates every auth-scoped cache: dropping the PAT must also
    // drop the GitHub-grounded query snapshots (repos, activity scan) so a later
    // token — or a different account — does not rehydrate the prior listings
    // from the persisted cache.
    clearAuthScopedClientCache();
    return true;
  } catch (err) {
    if (isDexieClosedError(err)) {
      return false;
    }
    throw err;
  }
}
