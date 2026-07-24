"use client";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import {
  clearDefaultIssueViewId,
  getDefaultIssueViewId,
  getPersistedIssueFilter,
} from "@/lib/storage/config";
import { withVault } from "@/lib/workspaceHref";
import type { SavedIssueView } from "@reef/core";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  buildIssueSearchParams,
  canonicalIssueQuery,
  hasIssueFilterQueryParams,
  hasIssueQueryParams,
  normalizeRestoredSort,
  readIssueUrlState,
  savedIssueViewHref,
  savedIssueViewPayloadToSearchParams,
} from "../../lib/issueViewCodec";
import { useIssueStore } from "../../stores/useIssueStore";

/**
 * The list/board workspace is scoped to the vault's issues list
 * (`/workspace/{vault}/issues`). That workspace also mounts as the backdrop
 * behind `.../issues/[id]` (detail slide-over on hard nav, or the
 * intercepting-route modal on soft nav), where `usePathname()` reports the
 * detail URL. Filter-to-URL mirroring is confined to the list route, or it
 * would push the filter query onto the detail URL and fight `router.back()`
 * when the sheet is closed. The vault-scoped path is computed in the hook
 * (REEF-315).
 */
const ISSUES_LIST_BASE = "/issues";

/**
 * Mirrors issue list/board filters via URL query params, and restores
 * the per-vault last-used filter from IndexedDB when the URL carries none
 * (REEF-009).
 *
 * The hydration source is decided per vault:
 *  - URL has issue params → URL wins; the IndexedDB restore is skipped (a
 *    shared/explicit link is honored over the personal saved filter).
 *  - URL has none → restore the vault's saved filter (async), once the active
 *    vault has hydrated. The in-memory store still wins for board↔list view
 *    switches (the filter is already non-pristine, so restore leaves it alone)
 *    and is mirrored onto the new route.
 *
 * Returns `skipNextSave`, a ref the companion `useIssueFilterPersistence` hook
 * consumes so it does not echo the just-restored value back to IndexedDB. The
 * the restore's own write is marked; user edits (including ones made while the
 * restore is still in flight) are left unmarked and saved normally.
 */
export function useIssueUrlSync(
  savedViews?: SavedIssueView[],
  savedViewsReady = true,
  savedViewsFailed = false,
): { skipNextSave: RefObject<boolean> } {
  const filter = useIssueStore((state) => state.filter);
  const searchQuery = useIssueStore((state) => state.searchQuery);
  const { vault } = useActiveVault();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const currentIssueQuery = useRef(canonicalIssueQuery(searchParams));
  currentIssueQuery.current = canonicalIssueQuery(searchParams);
  const lastObservedIssueQuery = useRef(currentIssueQuery.current);
  // Store→URL writes are already represented by the current store. Remember
  // their destination so the reactive URL observer below does not echo them
  // back as an external history navigation.
  const pendingIssueQuery = useRef<string | null>(null);
  // Holds an external query transition through the first store→URL effect run.
  // React effects in the same commit still see the pre-transition store props,
  // so this prevents that stale render from immediately overwriting Back.
  const applyingIssueQuery = useRef<string | null>(null);

  // Gates URL writeback. Set as soon as the hydration source is decided
  // (synchronously, before any async restore settles) so a user filter change —
  // or a view switch's mirror — still reaches the URL during the restore window.
  const initialized = useRef(false);
  // Fire the async restore at most once per mounted vault.
  const restoreStarted = useRef(false);
  // Suppresses the next store→URL writeback (for our own restore / URL-apply set).
  const skipNextWrite = useRef(false);
  // Marks the restore's own filter write so the persistence hook does not echo
  // the restored value back to IndexedDB. Consumed in useIssueFilterPersistence;
  // user edits are unmarked and persisted even mid-restore.
  const skipNextSave = useRef(false);
  // Marks a store→URL mirror that originates from an IndexedDB restore; it should
  // REPLACE the current history entry (hydration, not navigation) so no bare
  // /issues entry is stacked behind the restored filter (REEF-010).
  const replaceNextWrite = useRef(false);
  // A vault switch clears the previous vault's mirrored query as hydration,
  // not as the user's explicit "show all" choice. Keep that destination bare
  // so the new vault can retain its normal default-landing semantics.
  const omitEmptyMarkerNextWrite = useRef(false);
  // A fresh mount on the same vault can inherit the previous Issues store
  // state. Hold only that baseline out of store→URL mirroring until the bare
  // landing's default/last-used lookup settles; a user edit changes object
  // identity and remains eligible to mirror immediately.
  const restoreBaseline = useRef<{
    filter: typeof filter;
    searchQuery: string;
    vault: string;
  } | null>(null);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [landingRevision, setLandingRevision] = useState(0);

  // searchParams is read for the hydration decision (URL-wins vs
  // IndexedDB restore) and the stale-URL clear on a vault switch. Re-running on the
  // URL changes this hook ITSELF writes would abort the in-flight restore and drop
  // the new vault's saved filter (REEF-010). Post-init URL→store reactivity is
  // intentionally not wanted; the mirror effect below owns store→URL sync.
  /* eslint-disable react-hooks/exhaustive-deps -- searchParams is read at hydration; self-written URL changes should not abort the restore. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchParams is read once at hydration; re-running on self-written URL changes would abort the in-flight restore (REEF-010).
  useEffect(() => {
    void landingRevision;
    // `filterVault` (in the module-level store) tags which vault the current
    // store filter belongs to. The store survives `/issues` unmounts but the
    // refs above do not, so comparing the tag to the active vault detects a
    // vault/account switch whether it happened mid-mount OR while the workspace
    // was unmounted (Settings switch, account re-login).
    const filterVault = useIssueStore.getState().filterVault;
    const vaultChanged =
      !!vault && filterVault !== null && filterVault !== vault;
    if (vaultChanged) {
      initialized.current = false;
      restoreStarted.current = false;
    }

    if (initialized.current) {
      // Adopt the vault if we initialized from a URL before it hydrated, so a
      // later (possibly unmounted) switch is still detected.
      if (vault && filterVault === null) {
        useIssueStore.setState({ filterVault: vault });
      }
      return;
    }

    // URL wins over the saved filter on initial hydration, but not
    // on a vault switch. REEF-010 mirrors a restored personal filter into the
    // URL, so after switching vaults the URL still carries the PREVIOUS vault's
    // restored params; treating those as an explicit "URL wins" filter would leak
    // the old vault's personal filter into the new vault (and re-apply it on a
    // reload). A genuine vault switch re-restores from the new vault's slot.
    if (!vaultChanged && hasIssueFilterQueryParams(searchParams)) {
      skipNextWrite.current = true;
      useIssueStore.setState({
        ...readIssueUrlState(searchParams),
        filterVault: vault || null,
      });
      initialized.current = true;
      return;
    }

    // No URL params: restore from IndexedDB after the active vault has
    // hydrated (it is "" on the server + first client render).
    if (!vault) return;
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    // Unblock writeback now (view-switch mirror / user edits); saving stays
    // gated on persistReady until the async read settles below.
    initialized.current = true;

    // Claim the store filter for this vault. On a switch (incl. one that
    // happened while unmounted), drop the previous vault's in-memory filter so
    // the new vault's saved value wins and the pristine guard below is not
    // blocked by the stale filter.
    if (vaultChanged) {
      // Clearing the previous vault's filter. If that vault left mirrored params
      // in the URL (REEF-010), clear them via REPLACE so the stale filter neither
      // lingers nor leaks back in on the next mount/reload — without stacking a
      // history entry. If the URL is already bare there is nothing to mirror, so
      // suppress the one writeback. (Safe to write the URL here now that this
      // effect no longer depends on searchParams, so the resulting change does not
      // re-run it and abort the restore started below.)
      if (hasIssueQueryParams(searchParams)) {
        replaceNextWrite.current = true;
        omitEmptyMarkerNextWrite.current = true;
      } else {
        skipNextWrite.current = true;
      }
      useIssueStore.setState({
        filter: {},
        searchQuery: "",
        filterVault: vault,
      });
    } else {
      useIssueStore.setState({ filterVault: vault });
    }

    const restoringVault = vault;
    const restoringQuery = currentIssueQuery.current;
    const restoringState = useIssueStore.getState();
    const restoringFilter = restoringState.filter;
    const restoringSearchQuery = restoringState.searchQuery;
    const restoreToken = {
      filter: restoringFilter,
      searchQuery: restoringSearchQuery,
      vault: restoringVault,
    };
    restoreBaseline.current = restoreToken;
    let aborted = false;
    let settled = false;
    void (async () => {
      try {
        // A view-mode-only URL still allows the legacy last-used filter to
        // restore, but it is explicit navigation and must not be replaced by a
        // personal named-view default. This preserves the established
        // `?view=list` restore contract while keeping explicit URLs ahead of
        // the default pointer.
        let defaultId: string | undefined;
        if (!hasIssueQueryParams(searchParams)) {
          try {
            defaultId = await getDefaultIssueViewId(restoringVault);
          } catch {
            // Browser storage is an optional personal layer. A failed default
            // read must not reject the landing restore or block the independent
            // last-used filter fallback below.
            defaultId = undefined;
          }
        }
        if (!aborted && defaultId) {
          const currentState = useIssueStore.getState();
          if (
            currentIssueQuery.current !== restoringQuery ||
            currentState.filter !== restoringFilter ||
            currentState.searchQuery !== restoringSearchQuery
          ) {
            return;
          }
          if (!savedViewsReady && !savedViewsFailed) {
            initialized.current = false;
            restoreStarted.current = false;
            return;
          }
          if (savedViewsReady) {
            const defaultView = savedViews?.find(
              (view) => view.id === defaultId,
            );
            if (defaultView) {
              const params = savedIssueViewPayloadToSearchParams(
                defaultView.payload,
              );
              if (params.size === 0) {
                await clearDefaultIssueViewId(restoringVault);
              } else {
                const state = readIssueUrlState(params);
                skipNextSave.current = true;
                skipNextWrite.current = true;
                useIssueStore.setState({
                  ...state,
                  filterVault: restoringVault,
                });
                pendingIssueQuery.current = canonicalIssueQuery(params);
                router.replace(
                  savedIssueViewHref(
                    restoringVault,
                    defaultView.payload,
                    defaultView.id,
                  ),
                  {
                    scroll: false,
                  },
                );
                return;
              }
            }
            await clearDefaultIssueViewId(restoringVault);
          }
        }
        const stored = await getPersistedIssueFilter(restoringVault);
        // Apply if this read wasn't superseded (a vault switch aborts it; URL
        // changes do NOT, since this effect no longer depends on searchParams) AND
        // the user hasn't started filtering during the await. A same-vault bare
        // remount legitimately begins with the prior in-memory filter, so identity
        // against the captured baseline is the concurrency guard; a live edit
        // replaces that object and still wins over the saved value.
        if (!aborted) {
          const state = useIssueStore.getState();
          const pristine =
            Object.keys(state.filter).length === 0 && state.searchQuery === "";
          const unchangedBaseline =
            state.filter === restoringFilter &&
            state.searchQuery === restoringSearchQuery;
          if (
            (pristine || unchangedBaseline) &&
            Object.keys(stored).length > 0
          ) {
            // REEF-010: mirror the restored filter onto the URL, but as a REPLACE
            // (hydration, not navigation) so the bare /issues entry is rewritten in
            // place rather than a new history entry being stacked. (This branch
            // previously set skipNextWrite to suppress the mirror entirely.)
            replaceNextWrite.current = true;
            // Mark this as the restore's own write so the persistence hook does
            // not save the restored value straight back. A user edit during the
            // await makes the store non-pristine, so this branch is skipped and
            // their edit is persisted normally.
            skipNextSave.current = true;
            useIssueStore.setState({ filter: normalizeRestoredSort(stored) });
          }
        }
      } finally {
        settled = true;
        if (!aborted && restoreBaseline.current === restoreToken) {
          restoreBaseline.current = null;
          setRestoreRevision((revision) => revision + 1);
        }
      }
    })();

    return () => {
      aborted = true;
      if (restoreBaseline.current === restoreToken) {
        restoreBaseline.current = null;
      }
      // React Strict Effects intentionally cleans up and replays a newly
      // mounted effect. If that interrupts this async read, make the replay
      // eligible to start it again instead of leaving initialized=true with no
      // live restore. A completed restore keeps its initialization state.
      if (!settled) {
        initialized.current = false;
        restoreStarted.current = false;
      }
    };
  }, [landingRevision, savedViews, savedViewsFailed, savedViewsReady, vault]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const nextIssueQuery = canonicalIssueQuery(searchParams);
    if (nextIssueQuery === lastObservedIssueQuery.current) return;

    const issuesPath = withVault(vault, ISSUES_LIST_BASE);
    const browserPathname =
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/workspace/")
        ? window.location.pathname
        : pathname;
    if (pathname !== issuesPath || browserPathname !== issuesPath) return;

    // Consume a query transition only once both Next's pathname and the
    // browser location agree that the Issues list owns it. A split transition
    // can publish the destination query first.
    lastObservedIssueQuery.current = nextIssueQuery;
    if (pendingIssueQuery.current === nextIssueQuery) {
      pendingIssueQuery.current = null;
      return;
    }
    // A different navigation supersedes an unobserved internal destination.
    pendingIssueQuery.current = null;
    if (!initialized.current) return;

    applyingIssueQuery.current = nextIssueQuery;
    if (!hasIssueFilterQueryParams(searchParams)) {
      // Bare and view-only external navigation is a landing, not an explicit
      // clear. Reuse the initial default/last-used restoration policy. Links
      // that intentionally mean "show all" carry `filter=none` and take the
      // direct URL→store branch below.
      initialized.current = false;
      restoreStarted.current = false;
      // Drop the previous explicit URL state before the async landing lookup.
      // Mark the internal clear so persistence cannot overwrite the last-used
      // value that this same landing is about to read.
      skipNextSave.current = true;
      useIssueStore.setState({
        filter: {},
        searchQuery: "",
        filterVault: vault || null,
      });
      setLandingRevision((revision) => revision + 1);
      return;
    }
    skipNextWrite.current = true;
    useIssueStore.setState({
      ...readIssueUrlState(searchParams),
      filterVault: vault || null,
    });
  }, [pathname, searchParams, vault]);

  useEffect(() => {
    // The revision reruns this effect when an async bare-landing lookup settles
    // without changing the store (for example, no default and no persisted
    // filter), so the retained same-vault baseline can then mirror normally.
    void restoreRevision;
    if (!initialized.current) return;
    const observedIssueQuery = canonicalIssueQuery(searchParams);
    if (applyingIssueQuery.current === observedIssueQuery) {
      applyingIssueQuery.current = null;
      return;
    }
    const baseline = restoreBaseline.current;
    if (
      baseline?.vault === vault &&
      baseline.filter === filter &&
      baseline.searchQuery === searchQuery
    ) {
      return;
    }
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    // Mirror the filter onto the list route. While a detail sheet is open
    // the workspace is the backdrop and `pathname` is `.../issues/[id]`;
    // writing the filter query there pollutes history and bounces `router.back()`
    // straight back to the detail URL, keeping the sheet open.
    const issuesPath = withVault(vault, ISSUES_LIST_BASE);
    // During a cross-route transition Next can publish the destination search
    // params one render before usePathname. The browser location is already
    // authoritative then; checking it prevents the stale Issues hook from
    // pushing its filters over the destination navigation.
    const browserPathname =
      typeof window !== "undefined" &&
      window.location.pathname.startsWith("/workspace/")
        ? window.location.pathname
        : pathname;
    if (pathname !== issuesPath || browserPathname !== issuesPath) return;

    const currentParams = searchParams.toString();
    let paramString = buildIssueSearchParams(
      filter,
      searchQuery,
      new URLSearchParams(currentParams),
    );
    if (omitEmptyMarkerNextWrite.current) {
      const params = new URLSearchParams(paramString);
      params.delete("filter");
      paramString = params.toString();
    }
    // Compare order-insensitively: merging from `base` can reorder keys
    // without changing meaning, and we don't want a pure reorder to trigger
    // a redundant navigation.
    if (
      canonicalIssueQuery(paramString) !== canonicalIssueQuery(currentParams)
    ) {
      // REEF-010: a restore/vault-switch-clear mirror REPLACES the current
      // history entry (hydration, not navigation); a user edit PUSHES a
      // shareable/back-able entry. Read and clear the one-shot flag here, when
      // a navigation fires, so an intermediate no-op mirror run
      // (a searchParams change with an unchanged filter, as happens on the first
      // render of a vault switch) does not swallow the flag before the real write.
      const useReplace = replaceNextWrite.current;
      replaceNextWrite.current = false;
      omitEmptyMarkerNextWrite.current = false;
      const href = `${pathname}${paramString ? `?${paramString}` : ""}`;
      pendingIssueQuery.current = canonicalIssueQuery(paramString);
      if (useReplace) {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    }
  }, [
    filter,
    pathname,
    restoreRevision,
    router,
    searchParams,
    searchQuery,
    vault,
  ]);

  return { skipNextSave };
}
