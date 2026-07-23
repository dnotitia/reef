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
import { type RefObject, useEffect, useRef } from "react";
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

  // searchParams is read for the hydration decision (URL-wins vs
  // IndexedDB restore) and the stale-URL clear on a vault switch. Re-running on the
  // URL changes this hook ITSELF writes would abort the in-flight restore and drop
  // the new vault's saved filter (REEF-010). Post-init URL→store reactivity is
  // intentionally not wanted; the mirror effect below owns store→URL sync.
  /* eslint-disable react-hooks/exhaustive-deps -- searchParams is read at hydration; self-written URL changes should not abort the restore. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchParams is read once at hydration; re-running on self-written URL changes would abort the in-flight restore (REEF-010).
  useEffect(() => {
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
    let aborted = false;
    let settled = false;
    void (async () => {
      try {
        // A view-mode-only URL still allows the legacy last-used filter to
        // restore, but it is explicit navigation and must not be replaced by a
        // personal named-view default. This preserves the established
        // `?view=list` restore contract while keeping explicit URLs ahead of
        // the default pointer.
        const defaultId = hasIssueQueryParams(searchParams)
          ? undefined
          : await getDefaultIssueViewId(restoringVault);
        if (!aborted && defaultId) {
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
                router.replace(
                  savedIssueViewHref(restoringVault, defaultView.payload),
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
        // the user hasn't started filtering during the await — a live user action
        // takes precedence over the saved value. When the user did edit mid-await
        // the store is non-pristine, so this branch is skipped and the mirror effect
        // has already pushed their edit to the URL; the empty-vault case has its
        // stale URL cleared by the vault-switch clear above.
        if (!aborted) {
          const state = useIssueStore.getState();
          const pristine =
            Object.keys(state.filter).length === 0 && state.searchQuery === "";
          if (pristine && Object.keys(stored).length > 0) {
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
      }
    })();

    return () => {
      aborted = true;
      // React Strict Effects intentionally cleans up and replays a newly
      // mounted effect. If that interrupts this async read, make the replay
      // eligible to start it again instead of leaving initialized=true with no
      // live restore. A completed restore keeps its initialization state.
      if (!settled) {
        initialized.current = false;
        restoreStarted.current = false;
      }
    };
  }, [savedViews, savedViewsFailed, savedViewsReady, vault]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    if (!initialized.current) return;
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    // Mirror the filter onto the list route. While a detail sheet is open
    // the workspace is the backdrop and `pathname` is `.../issues/[id]`;
    // writing the filter query there pollutes history and bounces `router.back()`
    // straight back to the detail URL, keeping the sheet open.
    if (pathname !== withVault(vault, ISSUES_LIST_BASE)) return;

    const currentParams = searchParams.toString();
    const paramString = buildIssueSearchParams(
      filter,
      searchQuery,
      new URLSearchParams(currentParams),
    );
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
      const href = `${pathname}${paramString ? `?${paramString}` : ""}`;
      if (useReplace) {
        router.replace(href, { scroll: false });
      } else {
        router.push(href, { scroll: false });
      }
    }
  }, [filter, pathname, router, searchParams, searchQuery, vault]);

  return { skipNextSave };
}
