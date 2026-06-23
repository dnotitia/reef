/**
 * Helpers for invalidating browser-side query cache when account/session
 * identity changes.
 *
 * The TanStack Query persister (configured in QueryProvider) writes a
 * snapshot to localStorage under `REACT_QUERY_OFFLINE_CACHE`. `useRepos`
 * also stores an `If-None-Match` ETag under `reef:etag:*`. None of these
 * are scoped to an AKB account identifier. When the user signs out or switches
 * accounts, leftover state can leak the previous account's repos / issues to
 * whoever picks up the session next. To prevent that we wipe both layers and
 * dispatch
 * AUTH_CHANGED_EVENT so the in-memory QueryClient can also call clear()
 * (handled in QueryProvider).
 *
 * The window event reaches the tab that triggered the change. A second
 * reef tab open on the same browser keeps the previous account's in-memory
 * data until it hears about the change, so we also mirror it across tabs via a
 * BroadcastChannel; receiving tabs re-dispatch AUTH_CHANGED_EVENT locally (see
 * subscribeCrossTabAuthChange). (REEF-106)
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

/** Cross-tab channel name; an auth change in any tab is mirrored to siblings. */
const AUTH_BROADCAST_CHANNEL = "reef:auth";

/**
 * Lazily-created BroadcastChannel that mirrors auth changes across tabs of the
 * same origin. One instance per tab serves as sender (postMessage in
 * `clearAuthScopedClientCache`) and receiver (`subscribeCrossTabAuthChange`).
 * BroadcastChannel does not deliver a message back to the instance that sent it,
 * so the tab that triggered the change does not re-process its own broadcast.
 *
 * Returns null when BroadcastChannel is unavailable (SSR, private mode, or an
 * old runtime) — the single-tab dispatch path stays fully functional.
 */
let authChannel: BroadcastChannel | null = null;
function getAuthChannel(): BroadcastChannel | null {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return null;
  }
  if (authChannel === null) {
    try {
      authChannel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
    } catch {
      authChannel = null;
    }
  }
  return authChannel;
}

/**
 * Wipe every browser-side cache entry that was populated under the
 * previous account/session, and notify the in-memory QueryClient via a window
 * event.
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

  // Mirror the change to other reef tabs of this origin. The window event
  // above reaches this tab; siblings keep the previous account's in-memory
  // QueryClient / entity-store data until they hear about it. Best-effort: a
  // missing channel leaves the single-tab path (already run above) intact.
  try {
    getAuthChannel()?.postMessage(AUTH_CHANGED_EVENT);
  } catch {
    // Channel closed mid-flight or postMessage unsupported — non-fatal.
  }
}

/**
 * Subscribe this tab to cross-tab auth changes. When another tab signs out or
 * switches accounts, it broadcasts on the shared channel; here we re-dispatch
 * AUTH_CHANGED_EVENT on this tab's window so the same in-tab consumers
 * (QueryProvider's `clear()` + entity-store purge) run and the previous
 * account's in-memory data is dropped.
 *
 * Returns an unsubscribe function. No-op (returns a no-op cleanup) when
 * BroadcastChannel is unavailable, so callers can wire it unconditionally. The
 * receiver re-dispatches the local window event; it does not re-broadcast,
 * so there is no cross-tab echo. (REEF-106)
 */
export function subscribeCrossTabAuthChange(): () => void {
  const channel = getAuthChannel();
  if (channel === null) return () => {};

  const handler = (event: MessageEvent) => {
    if (event.data !== AUTH_CHANGED_EVENT) return;
    try {
      window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
    } catch {
      // CustomEvent unsupported (extremely old runtimes) — non-fatal.
    }
  };
  channel.addEventListener("message", handler);
  return () => channel.removeEventListener("message", handler);
}

/**
 * Test helper: close and forget the cross-tab channel singleton so each test can
 * start from a clean slate and swap in a fresh BroadcastChannel mock. Not part
 * of the runtime API.
 */
export function __resetAuthChannelForTests(): void {
  try {
    authChannel?.close();
  } catch {
    // already closed — ignore
  }
  authChannel = null;
}
