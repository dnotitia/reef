// "use client" — this hook is client (Dexie/IndexedDB is browser state)
import { getConfigValue, setConfigValue } from "@/lib/storage/config";
import { useCallback, useEffect, useState } from "react";

const LAST_VISIT_AT_KEY = "last_visit_at";

/**
 * Reads and writes the `last_visit_at` timestamp from the IndexedDB `config`
 * store.
 *
 * Design notes:
 *  - Uses a `useEffect`-driven pattern, not TanStack Query — this is
 *    Dexie/browser state, not server state.
 *  - `updateLastVisitAt()` writes the current ISO 8601 timestamp and syncs
 *    local state so the component re-renders without a remount.
 *  - `isLoading` lets callers distinguish "still hydrating from IndexedDB"
 *    (undefined transient) from "no prior visit recorded" (undefined steady
 *    state). ActivityFeed needs this so it can capture the pre-visit value
 *    exactly once before auto-updating the timestamp on mount.
 *
 * @returns `{ lastVisitAt, isLoading, updateLastVisitAt }`
 */
export function useLastVisitAt(): {
  lastVisitAt: string | undefined;
  isLoading: boolean;
  updateLastVisitAt: () => Promise<void>;
} {
  const [lastVisitAt, setLastVisitAt] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getConfigValue(LAST_VISIT_AT_KEY)
      .then((v) => {
        if (!cancelled) setLastVisitAt(v);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateLastVisitAt = useCallback(async () => {
    const now = new Date().toISOString();
    await setConfigValue(LAST_VISIT_AT_KEY, now);
    setLastVisitAt(now);
  }, []);

  return { lastVisitAt, isLoading, updateLastVisitAt };
}
