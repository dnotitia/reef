/**
 * Helpers for invalidating the browser-side query cache when the GitHub
 * credential changes.
 *
 * The TanStack Query persister (configured in QueryProvider) writes a
 * snapshot to localStorage under `REACT_QUERY_OFFLINE_CACHE`. `useRepos`
 * also stores an `If-None-Match` ETag under `reef:etag:*`. None of these
 * are scoped to a GitHub account identifier
 * — when the user disconnects or switches accounts, leftover state can
 * leak the previous account's repos / issues to whoever picks up the
 * session next. To prevent that we wipe both layers, and dispatch
 * AUTH_CHANGED_EVENT so the in-memory QueryClient can also call clear()
 * (handled in QueryProvider).
 */

/**
 * localStorage key under which the TanStack Query persister writes its
 * snapshot. Exported so QueryProvider passes the same value to
 * `createAsyncStoragePersister({ key })` — keeping both sides in sync
 * without relying on the library's default.
 */
export const PERSISTED_QUERY_CACHE_KEY = "REACT_QUERY_OFFLINE_CACHE";

/** Prefix shared by per-resource ETag keys (see useRepos). */
const ETAG_KEY_PREFIX = "reef:etag:";

/** DOM event broadcast on credential change. QueryProvider subscribes to it. */
export const AUTH_CHANGED_EVENT = "reef:auth-changed";

/**
 * Wipe every browser-side cache entry that was populated under the
 * previous GitHub credential, and notify the in-memory QueryClient via a
 * window event.
 *
 * Safe to call from SSR (no-op when `window` is undefined) and from
 * environments where localStorage throws (private mode / disabled).
 */
export function clearAuthScopedClientCache(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(PERSISTED_QUERY_CACHE_KEY);

    // Two-pass removal: localStorage keys shift indices after deletion,
    // so collect first then delete to avoid skipping entries.
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(ETAG_KEY_PREFIX)) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable — non-fatal; the in-memory clear below still runs.
  }

  try {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  } catch {
    // CustomEvent unsupported (extremely old runtimes) — non-fatal.
  }
}
