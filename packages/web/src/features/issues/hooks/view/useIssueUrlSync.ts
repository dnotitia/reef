"use client";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { getPersistedIssueFilter } from "@/lib/storage/config";
import { withVault } from "@/lib/workspaceHref";
import { StatusEnum, USER_SORT_FIELDS } from "@reef/core";
import { type UserSortField, naturalSortOrder } from "@reef/core/fields";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type RefObject, useEffect, useRef } from "react";
import { type IssueFilter, useIssueStore } from "../../stores/useIssueStore";

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

const ISSUE_QUERY_KEYS = [
  "status",
  "type",
  "priority",
  "assignee",
  "requester",
  "sprint_id",
  "milestone_id",
  "release_id",
  "severity",
  "due",
  "labels",
  "dep",
  "archived",
  "stale",
  "sort",
  "order",
  "q",
] as const;

function readIssueUrlState(searchParams: URLSearchParams): {
  filter: IssueFilter;
  searchQuery: string;
} {
  const filter: IssueFilter = {};

  // Multi-select facets (REEF-031) read every repeated param; compatible with
  // older single-value shared URLs. Status values are validated against
  // the enum and unknown members dropped — so a stale shared/bookmarked
  // `?status=open` (the value renamed to `todo` in REEF-139) is ignored rather
  // than left in client state where `filterIssues` would match it against no
  // issue and empty the list. Mirrors `buildIssueQuery`'s server-side drop and
  // the `due`/`dep` facet validation below.
  const status = searchParams
    .getAll("status")
    .filter((s) => StatusEnum.safeParse(s).success);
  const issueType = searchParams.getAll("type");
  const priority = searchParams.getAll("priority");
  // assignee/requester/sprint/release are multi-select (REEF-267): read every
  // repeated param, compatible with older single-value shared URLs. Blank members
  // (a hand-edited `?assignee=`) are dropped so the store does not carry an empty
  // value that would inflate the active-filter count or be sent to the server.
  // milestone stays single (a bare `?milestone_id=` is already falsy below).
  const assignee = searchParams.getAll("assignee").filter((v) => v.trim());
  const requester = searchParams.getAll("requester").filter((v) => v.trim());
  const sprintId = searchParams.getAll("sprint_id").filter((v) => v.trim());
  const milestoneId = searchParams.get("milestone_id");
  const releaseId = searchParams.getAll("release_id").filter((v) => v.trim());
  const severity = searchParams.getAll("severity");
  const due = searchParams
    .getAll("due")
    .filter(
      (d): d is "overdue" | "due_soon" => d === "overdue" || d === "due_soon",
    );
  const label = searchParams.get("labels");
  const dep = searchParams
    .getAll("dep")
    .filter(
      (d): d is "blocked" | "blocking" => d === "blocked" || d === "blocking",
    );
  const sort = searchParams.get("sort");
  const order = searchParams.get("order");
  const archived = searchParams.get("archived");
  const stale = searchParams.get("stale");

  if (status.length) filter.status = status;
  if (issueType.length) filter.issueType = issueType;
  if (priority.length) filter.priority = priority;
  if (assignee.length) filter.assignee = assignee;
  if (requester.length) filter.requester = requester;
  if (sprintId.length) filter.sprint_id = sprintId;
  if (milestoneId) filter.milestone_id = milestoneId;
  if (releaseId.length) filter.release_id = releaseId;
  if (severity.length) filter.severity = severity;
  if (due.length) filter.due = due;
  if (label) filter.label = label;
  if (dep.length) filter.dependencyFilter = dep;
  // Validate against the single source (USER_SORT_FIELDS) so a new sort field
  // is restorable from a shared URL without editing this guard. Order is read
  // read alongside a valid field (a fieldless `order` is dropped here); an
  // orderless field is backfilled by normalizeRestoredSort below. Together they
  // keep the store's sort invariant: field ⟺ order.
  if (sort && (USER_SORT_FIELDS as readonly string[]).includes(sort)) {
    filter.sortField = sort as UserSortField;
    if (order === "asc" || order === "desc") {
      filter.sortOrder = order;
    }
  }
  // REEF-010: a link may carry our emitted `archived=1`, or `archived=true`
  // (tolerated for hand-written/externally-shared links). Absence ⇒ key omitted
  // => store default; this reader leaves showArchived=false to the store.
  if (archived === "1" || archived === "true") {
    filter.showArchived = true;
  }
  // REEF-275: same tolerant codec as `archived` — `stale=1` (our emitted form)
  // or `stale=true` (hand-written links) reveals the auto-hidden resolved issues.
  if (stale === "1" || stale === "true") {
    filter.showStale = true;
  }

  return {
    filter: normalizeRestoredSort(filter),
    searchQuery: searchParams.get("q") ?? "",
  };
}

/**
 * Backfill a RESTORED filter (URL or saved) so `sortField` carries an
 * order. A field without an order (a hand-edited / older shared URL, or a
 * partial saved filter) is filled with that field's natural direction so the
 * sort control's label matches the rendered board/list order (REEF-059) — the
 * display, the client `sortIssues`, and the server `buildIssueQuery` otherwise
 * resolve a missing order three different ways, so the control could show one
 * direction while the rows render another. The URL reader drops fieldless order
 * params, and the store/persistence path avoids producing them, so this fills
 * the missing half when present.
 */
function normalizeRestoredSort(filter: IssueFilter): IssueFilter {
  if (
    filter.sortField &&
    filter.sortOrder !== "asc" &&
    filter.sortOrder !== "desc"
  ) {
    return { ...filter, sortOrder: naturalSortOrder(filter.sortField) };
  }
  return filter;
}

function hasIssueQueryParams(searchParams: URLSearchParams): boolean {
  return ISSUE_QUERY_KEYS.some((key) => searchParams.has(key));
}

function buildIssueSearchParams(
  filter: IssueFilter,
  searchQuery: string,
  base: URLSearchParams,
): string {
  // Merge into the existing query string: clear the keys this hook manages so
  // unrelated params (notably `?view=`, owned by the workspace ViewSwitcher)
  // survive a filter change.
  const params = new URLSearchParams(base);
  for (const key of ISSUE_QUERY_KEYS) params.delete(key);
  // Multi-select facets (REEF-031) emit one repeated param per selected value.
  if (filter.status) for (const v of filter.status) params.append("status", v);
  if (filter.issueType)
    for (const v of filter.issueType) params.append("type", v);
  if (filter.priority)
    for (const v of filter.priority) params.append("priority", v);
  // Multi-select people/planning facets (REEF-267) emit one repeated param per
  // value; milestone stays a single param.
  if (filter.assignee)
    for (const v of filter.assignee) params.append("assignee", v);
  if (filter.requester)
    for (const v of filter.requester) params.append("requester", v);
  if (filter.sprint_id)
    for (const v of filter.sprint_id) params.append("sprint_id", v);
  if (filter.milestone_id) params.set("milestone_id", filter.milestone_id);
  if (filter.release_id)
    for (const v of filter.release_id) params.append("release_id", v);
  if (filter.severity)
    for (const v of filter.severity) params.append("severity", v);
  if (filter.due) for (const v of filter.due) params.append("due", v);
  if (filter.label) params.set("labels", filter.label);
  if (filter.dependencyFilter)
    for (const v of filter.dependencyFilter) params.append("dep", v);
  // REEF-010: emit `archived=1` when the toggle is on. FilterBar stores
  // `undefined` when off, so a default landing URL stays
  // bare. NOTE: the wire codec (buildIssueQuery) sends `archived=true` to the
  // server — a separate codec; do not unify the two.
  if (filter.showArchived) params.set("archived", "1");
  if (filter.showStale) params.set("stale", "1");
  if (filter.sortField) params.set("sort", filter.sortField);
  if (filter.sortOrder) params.set("order", filter.sortOrder);
  if (searchQuery) params.set("q", searchQuery);
  return params.toString();
}

/** Sort params into a canonical order so reordering diffs compare equal. */
function normalizeParams(query: string): string {
  const params = new URLSearchParams(query);
  params.sort();
  return params.toString();
}

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
export function useIssueUrlSync(): { skipNextSave: RefObject<boolean> } {
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
    if (!vaultChanged && hasIssueQueryParams(searchParams)) {
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
    void (async () => {
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
    })();

    return () => {
      aborted = true;
    };
  }, [vault]);
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
    if (normalizeParams(paramString) !== normalizeParams(currentParams)) {
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
