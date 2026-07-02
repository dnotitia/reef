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
 * A non-empty free-text `q` on a serialized list-query fragment. `q` matches the
 * issue's id/title/assignee/etc. server-side, so a content edit can change its
 * result set in ways the client does not predict — those variants refetch on any
 * edit. The plain (`['issues','list',vault]`) and facet variants have no `q` and
 * stay patched in place.
 */
function variantHasFreeText(variant: IssueQueryParams | undefined): boolean {
  return typeof variant?.q === "string" && variant.q.length > 0;
}

/**
 * Build an `invalidateQueries` predicate that refetches just the list variants a
 * single issue `patch` can actually change — membership, order, or free-text
 * match — instead of every `['issues','list',vault]` variant (REEF-098/REEF-323).
 *
 * One patch-based predicate covers both a membership edit (a server facet or the
 * sort field) and a non-membership content edit (title / dates / estimate /
 * labels / relations). The two `onSuccess` branches were folded into this: they
 * shared the same order-and-membership logic and differed by which keys they
 * inspected, so a non-membership edit used to refetch free-text variants and left
 * sort-order stale (REEF-325). A variant is refetched when it:
 *
 * - carries a free-text `q` (a content edit can shift its server-side match set
 *   unpredictably — see `variantHasFreeText`),
 * - is a `default_view` landing variant and a membership key changed (its scope
 *   is active sprint / open statuses / my-issues, so a status/sprint/
 *   assignee-class edit moves rows in or out; a pure content edit leaves it
 *   unchanged;
 *   defensive — the current client does not send this facet, but the server
 *   honors it and REEF-324 wired it),
 * - is an active-scoped variant and `archived_at` changed (archive/restore — see
 *   below),
 * - filters on a changed facet key (editing it can add or remove the issue from
 *   the facet), or
 * - sorts by a changed key, or by the server-stamped `updated_at` that every
 *   successful edit bumps. This is the REEF-325 fix: a title / due-date /
 *   estimate edit reorders an `updated_at`-sorted list (every edit restamps it)
 *   and a variant sorted by the edited field itself (`due_date` / `title` /
 *   `estimate_points` / `start_date`), which the old non-membership branch left
 *   stale until the 60s stale window. `sort_field` defaults to `priority`.
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
 * The bare full list (`['issues','list',vault]`, no query fragment) stays
 * patched in place: it sends no `archived` param, so the server returns every issue in
 * akb natural order — no field edit (archive included) changes its membership or
 * order, and the in-place `setQueriesData` patch keeps it correct.
 */
export function listInvalidationPredicate(
  patch: IssueUpdatePatch,
): (query: { queryKey: readonly unknown[] }) => boolean {
  // Every edited key drives the sort-order check below (a variant sorted by any
  // of them reorders); the membership subset drives the facet / default_view /
  // archived membership checks.
  const changedKeys = Object.keys(patch) as (keyof IssueUpdatePatch)[];
  const membershipKeys = changedListMembershipKeys(patch);
  const archivedChanged = membershipKeys.includes("archived_at");
  // Every membership key except `archived_at` surfaces as an explicit facet
  // whose presence on the key means the variant filters on it; `archived_at` is
  // handled separately above because its active scope is implicit (absent key).
  const explicitFacets = membershipKeys.filter((key) => key !== "archived_at");
  return ({ queryKey }) => {
    const variant = queryKey[3] as IssueQueryParams | undefined;
    if (!variant) return false;
    if (variantHasFreeText(variant)) return true;
    // A pure content/order edit leaves default_view membership unchanged, so gate
    // this on an actual membership-key change.
    if (membershipKeys.length > 0 && variant.default_view === "true")
      return true;
    if (archivedChanged && variant.archived !== "true") return true;
    if (explicitFacets.some((facet) => facet in variant)) return true;
    // Every successful edit bumps the server-stamped `updated_at`, so a variant
    // sorted by it reorders on any edit; otherwise a variant reorders when
    // sorted by a changed key (membership `priority`, or a content field like
    // `due_date` / `title` / `estimate_points` / `start_date`).
    if (variant.sort_field === "updated_at") return true;
    return changedKeys.some((key) => variant.sort_field === key);
  };
}
