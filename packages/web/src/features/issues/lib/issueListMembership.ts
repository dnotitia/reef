import type { IssueUpdatePatch } from "@reef/core";
import type { IssueQueryParams } from "./buildIssueQuery";

/**
 * Decide what an issue edit can invalidate, so mutations refetch narrowly
 * instead of blanket-invalidating the whole issue read path (REEF-098).
 *
 * The in-place cache patch a mutation already applies keeps list values fresh; a
 * refetch is needed when an edit can change *which* list an issue
 * belongs to (a server facet), *where* it sorts, or the relation graph.
 */

/**
 * Patch keys that map to a server-side issue-list facet (see `buildIssueQuery`)
 * or the default sort field (`priority`). Editing any of them can change
 * whether — or where — the issue appears in a filtered/sorted list, so the
 * affected list queries refetch to reconcile membership and order
 * rather than patched in place.
 */
const LIST_MEMBERSHIP_KEYS = [
  "status",
  "priority",
  "severity",
  "issue_type",
  "assigned_to",
  "requester",
  "sprint_id",
  "milestone_id",
  "release_id",
  "archived_at",
] as const satisfies readonly (keyof IssueUpdatePatch)[];

/**
 * The list-membership keys actually present in `patch`. Drives both the boolean
 * gate below and the narrowed invalidation predicate (REEF-323), which refetches
 * just the variants these keys can affect rather than every list variant.
 */
export function changedListMembershipKeys(
  patch: IssueUpdatePatch,
): (keyof IssueUpdatePatch)[] {
  return LIST_MEMBERSHIP_KEYS.filter((key) => key in patch);
}

export function patchAffectsListMembership(patch: IssueUpdatePatch): boolean {
  return changedListMembershipKeys(patch).length > 0;
}

/**
 * Patch keys reflected in the whole-vault relation projection
 * (`['issues','relations',vault]` → `{id, status, depends_on}`); editing them
 * shifts blocker / blocking state, so that projection refetches.
 */
const RELATION_GRAPH_KEYS = [
  "status",
  "depends_on",
  "blocks",
] as const satisfies readonly (keyof IssueUpdatePatch)[];

export function patchAffectsRelationGraph(patch: IssueUpdatePatch): boolean {
  return RELATION_GRAPH_KEYS.some((key) => key in patch);
}

/**
 * Patch keys whose edit appends a `reef_activity` timeline event — `status`
 * (status_change, REEF-063) plus every dimension `diffFieldActivityEvents`
 * logs (assignee / priority / planning links / impl refs, REEF-126; and the
 * REEF-277 parity set: title / due date / estimate / parent / archive / labels /
 * relations). Editing any of them should refetch the issue's activity query so the
 * unified timeline shows the freshly logged event immediately, the same path
 * status changes already used (REEF-064) — not just `status`. Keep this list in
 * lockstep with `diffFieldActivityEvents`: a logged field missing here leaves
 * its event invisible until a stale-window refetch or full reload.
 */
const ACTIVITY_TIMELINE_KEYS = [
  "status",
  "assigned_to",
  "priority",
  "milestone_id",
  "sprint_id",
  "release_id",
  "implementation_refs",
  "title",
  "due_date",
  "estimate_points",
  "parent_id",
  "archived_at",
  "labels",
  "depends_on",
  "blocks",
  "related_to",
] as const satisfies readonly (keyof IssueUpdatePatch)[];

export function patchAffectsActivityTimeline(patch: IssueUpdatePatch): boolean {
  return ACTIVITY_TIMELINE_KEYS.some((key) => key in patch);
}

/**
 * Whether a list query carries a free-text (`q`) facet. `q` matches the issue's
 * id/title/assignee/etc. server-side, so a content edit can change its result
 * set in ways the client does not predict — those variants refetch even for an
 * otherwise non-membership edit. The plain (`['issues','list',vault]`) and
 * facet variants have no `q` and stay patched in place.
 */
export function listQueryHasFreeText(query: {
  queryKey: readonly unknown[];
}): boolean {
  return variantHasFreeText(query.queryKey[3] as IssueQueryParams | undefined);
}

/** A non-empty free-text `q` on a serialized list-query fragment. */
function variantHasFreeText(variant: IssueQueryParams | undefined): boolean {
  return typeof variant?.q === "string" && variant.q.length > 0;
}

/**
 * Build an `invalidateQueries` predicate that refetches just the list variants
 * an edit to `changedKeys` can actually change, instead of every
 * `['issues','list',vault]` variant (REEF-323). It strictly narrows the old
 * blanket refetch — a variant is refetched when it:
 *
 * - carries a free-text `q` (a content edit can shift its server-side match set
 *   unpredictably — the same rationale as `listQueryHasFreeText`),
 * - is a `default_view` landing variant (scoped by active sprint / open statuses
 *   / my-issues, so a status/sprint/assignee change can move rows in or out;
 *   defensive — the current client does not send this facet, but the server
 *   honors it and REEF-324 may wire it),
 * - is an active-scoped variant and `archived_at` changed (archive/restore — see
 *   below),
 * - filters on a changed facet key (editing it can add or remove the issue from
 *   the facet), or
 * - sorts by a changed key, or by the server-stamped `updated_at` that every
 *   successful edit bumps (`sort_field` defaults to `priority`; a priority edit
 *   reorders priority-sorted variants, and an `updated_at`-sorted variant
 *   reorders on any edit).
 *
 * `archived_at` is special: an active variant filters `archived_at IS NULL`
 * implicitly — `buildIssueQuery` omits the `archived` facet from the key and just
 * sets `archived: "true"` to *widen* to both scopes — so a restore adds (and an
 * archive removes) the row from every active variant, which the in-place patch
 * does not do. So an `archived_at` change refetches every active variant
 * (`archived !== "true"`); a widened variant shows both scopes and is unchanged.
 * Matching on the absent `archived` facet would invert the decision, so it is handled
 * here rather than via the explicit-facet check.
 *
 * The bare full list (`['issues','list',vault]`, no query fragment) is does not
 * refetched: it sends no `archived` param, so the server returns every issue in
 * akb natural order — no field edit (archive included) changes its membership or
 * order, and the in-place `setQueriesData` patch keeps it correct.
 */
export function listMembershipInvalidationPredicate(
  changedKeys: readonly (keyof IssueUpdatePatch)[],
): (query: { queryKey: readonly unknown[] }) => boolean {
  const archivedChanged = changedKeys.includes("archived_at");
  // Every membership key except `archived_at` surfaces as an explicit facet
  // whose presence on the key means the variant filters on it; `archived_at` is
  // handled separately above because its active scope is implicit (absent key).
  const explicitFacets = changedKeys.filter((key) => key !== "archived_at");
  return ({ queryKey }) => {
    const variant = queryKey[3] as IssueQueryParams | undefined;
    if (!variant) return false;
    if (variantHasFreeText(variant)) return true;
    if (variant.default_view === "true") return true;
    if (archivedChanged && variant.archived !== "true") return true;
    if (explicitFacets.some((facet) => facet in variant)) return true;
    // Every successful edit bumps the server-stamped `updated_at`, so a variant
    // sorted by it reorders on any edit; otherwise a variant reorders when
    // sorted by a changed key (`sort_field` defaults to `priority`).
    if (variant.sort_field === "updated_at") return true;
    return changedKeys.some((key) => variant.sort_field === key);
  };
}
