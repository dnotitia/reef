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
