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

export function patchAffectsListMembership(patch: IssueUpdatePatch): boolean {
  return LIST_MEMBERSHIP_KEYS.some((key) => key in patch);
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
 * relations). Editing any of them must refetch the issue's activity query so the
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
  const params = query.queryKey[3] as IssueQueryParams | undefined;
  return typeof params?.q === "string" && params.q.length > 0;
}
