"use client";

import { startIssueEntityNormalizer } from "@/features/issues/lib/issueCacheNormalizer";
import { purgeAll } from "@/features/issues/stores/issueEntityStore";
import {
  AUTH_CHANGED_EVENT,
  PERSISTED_QUERY_CACHE_KEY,
  subscribeCrossTabAuthChange,
} from "@/lib/storage/clientCache";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  type Query,
  QueryClient,
  defaultShouldDehydrateQuery,
} from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, useState } from "react";

/**
 * Cache-schema version. Bump whenever a persisted query's response shape
 * changes in a way that would mis-render old cached data — the persister
 * drops any snapshot whose buster does not match.
 */
// v4: issue-list queries are now filter-keyed (`['issues','list',vault,<query>]`)
// and a new relation projection key (`['issues','relations',vault]`) was added.
// v5 (REEF-098): issue list/detail caches now feed a normalized entity store
// that is the render source for board/list rows; bump once so a stale snapshot
// does not render against the old read path (one blank reload is accepted).
const PERSIST_BUSTER = "reef-cache-v5";

export function shouldPersistQuery(query: Query): boolean {
  return defaultShouldDehydrateQuery(query) && query.meta?.persist !== false;
}

/**
 * Default staleTime / gcTime applied to every query.
 *
 * staleTime = 60s — within a minute the cached value is served without a
 * background revalidate, which removes per-tab-switch refetches.
 *
 * gcTime = 24h — keep cached values resident long enough that the persister
 * can rehydrate them on the next page load. Without this, queries inactive
 * for >5 min (default gcTime) would be evicted before persistence picked
 * them up on subsequent mounts.
 *
 * Hook-level overrides (e.g. useRepos with staleTime 5min, useIssueList
 * with staleTime 60s) compose on top of these defaults.
 */
function createReefQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 24 * 60 * 60_000,
      },
    },
  });
}

/**
 * Wraps children in PersistQueryClientProvider so the QueryClient cache is
 * persisted to localStorage. On reload, the cache is rehydrated synchronously
 * before the first render — list-style views render from cache instantly and
 * revalidate in the background per staleTime.
 *
 * Each Next.js render gets a fresh QueryClient via useState; persistence is
 * keyed by origin and rebuilt against the localStorage snapshot.
 *
 * The persister falls back to a no-op when `window` is undefined (SSR), so
 * server renders does not touch localStorage.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createReefQueryClient);

  const [persister] = useState(() => {
    if (typeof window === "undefined") {
      // SSR path — return a no-op persister shape so PersistQueryClientProvider
      // doesn't crash. The client will swap in the real localStorage persister
      // on the next browser-side render anyway via the snapshot below.
      return createAsyncStoragePersister({
        storage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
      });
    }
    return createAsyncStoragePersister({
      storage: window.localStorage,
      key: PERSISTED_QUERY_CACHE_KEY,
    });
  });

  // Mirror every issue list/detail query result into the normalized entity
  // store (the render source for board/list rows). Attached here, once per
  // QueryClient, so it also catches the persisted snapshot rehydrated on load.
  useEffect(() => startIssueEntityNormalizer(queryClient), [queryClient]);

  // When the akb account/session changes, clearAuthScopedClientCache wipes the
  // persisted snapshot AND broadcasts AUTH_CHANGED_EVENT. We also drop the
  // in-memory cache here so the next render does not flash the previous
  // account's data before refetch. queryClient.clear() invalidates every query
  // - broad on purpose, since cache entries below this layer are not
  // account-scoped. Purge the entity store on the same signal so it does not
  // outlive the account it was populated under.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      queryClient.clear();
      purgeAll();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handler);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, handler);
  }, [queryClient]);

  // Mirror auth changes from sibling tabs into this one. When another tab signs
  // out or switches account, it broadcasts on the shared channel and
  // subscribeCrossTabAuthChange re-dispatches AUTH_CHANGED_EVENT here, driving
  // the same in-memory clear as a same-tab change — so a sign-out in one tab no
  // longer leaves this tab showing the previous account's data. (REEF-106)
  useEffect(() => subscribeCrossTabAuthChange(), []);

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: PERSIST_BUSTER,
        dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
