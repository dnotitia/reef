import { type Status, isResolvedStatus } from "@reef/core";

/**
 * The minimal shape the dependency helpers need from a graph node — satisfied
 * by both `IssueListItem` (the displayed list projection) and `IssueRelation`
 * (the whole-vault relation projection). The graph can therefore be the small
 * relation projection while the displayed items stay full list items, so
 * blocker badges / the dependency filter stay correct even when the displayed
 * set is a server-filtered subset of the vault.
 */
export interface IssueRelationLike {
  id: string;
  status: Status;
  depends_on?: readonly string[] | null;
}

/**
 * Returns true if this issue has at least one unresolved dependency.
 * An unresolved dependency is a `depends_on` target that is either missing
 * from allIssues or whose status is not 'done'/'closed'.
 */
export function isBlocked(
  issue: IssueRelationLike,
  allIssues: readonly IssueRelationLike[],
): boolean {
  if (!issue.depends_on?.length) return false;
  const issueMap = new Map(allIssues.map((i) => [i.id, i]));
  return issue.depends_on.some((dep) => {
    const depIssue = issueMap.get(dep);
    return !depIssue || !isResolvedStatus(depIssue.status);
  });
}

/**
 * Returns true if this issue's id appears in another open issue's `depends_on`.
 * "Blocking" means at least one active (not done/closed) issue depends on this one.
 */
export function isBlocking(
  issue: IssueRelationLike,
  allIssues: readonly IssueRelationLike[],
): boolean {
  return allIssues.some(
    (other) =>
      other.id !== issue.id &&
      !isResolvedStatus(other.status) &&
      other.depends_on?.includes(issue.id),
  );
}

/**
 * Returns the count of unresolved blockers for this issue.
 * A blocker is unresolved if it's missing or not done/closed.
 */
export function getUnresolvedBlockerCount(
  issue: IssueRelationLike,
  allIssues: readonly IssueRelationLike[],
): number {
  if (!issue.depends_on?.length) return 0;
  const issueMap = new Map(allIssues.map((i) => [i.id, i]));
  return issue.depends_on.filter((dep) => {
    const depIssue = issueMap.get(dep);
    return !depIssue || !isResolvedStatus(depIssue.status);
  }).length;
}

/**
 * Build an id → node index once so callers rendering many rows (e.g. a search
 * dropdown) can resolve blocker state in O(1) per row instead of rebuilding the
 * map inside `isBlocked` / `getUnresolvedBlockerCount` on every call (O(n²)).
 */
export function indexIssuesById(
  allIssues: readonly IssueRelationLike[],
): Map<string, IssueRelationLike> {
  return new Map(allIssues.map((i) => [i.id, i]));
}

/**
 * `getUnresolvedBlockerCount` against a prebuilt index (see `indexIssuesById`).
 * Returns the number of unresolved `depends_on` targets; `0` means not blocked.
 */
export function unresolvedBlockerCountIn(
  issue: IssueRelationLike,
  index: ReadonlyMap<string, IssueRelationLike>,
): number {
  if (!issue.depends_on?.length) return 0;
  let count = 0;
  for (const dep of issue.depends_on) {
    const depIssue = index.get(dep);
    if (!depIssue || !isResolvedStatus(depIssue.status)) count++;
  }
  return count;
}

/**
 * Precompute the set of blocked issue ids in one pass. Each `issue`'s own
 * `depends_on` is matched against dependency statuses resolved from `graph` (the
 * whole-vault relation projection), mirroring `isBlocked(issue, graph)` exactly
 * — `issues` should be the displayed list projection, which mutations update
 * optimistically, while `graph` supplies dependency statuses. Keeping the
 * `depends_on` source on the optimistic list (not `graph`, which just refetches
 * after a dependency edit) avoids stale blocker badges.
 *
 * A board rendering many cards then hands each card a primitive `blocked`
 * boolean resolved via `Set.has` (O(1)) instead of re-running `isBlocked` —
 * which rebuilds an id index per call — once per card (O(n²) across the board).
 * Passing the derived boolean instead of the whole graph also keeps card props
 * stable enough for `memo` to skip unchanged cards. (REEF-097)
 */
export function computeBlockedIds(
  issues: readonly IssueRelationLike[],
  graph: readonly IssueRelationLike[],
): ReadonlySet<string> {
  const index = indexIssuesById(graph);
  const blocked = new Set<string>();
  for (const issue of issues) {
    if (unresolvedBlockerCountIn(issue, index) > 0) blocked.add(issue.id);
  }
  return blocked;
}

/**
 * Filters issues by dependency state.
 * - 'blocked': issues with at least one unresolved dependency
 * - 'blocking': issues that at least one active issue depends on
 * - null: returns all issues unchanged
 *
 * `allIssues` is the relation graph (ideally the whole-vault projection) so the
 * predicate stays correct when `issues` is a filtered subset.
 */
export function applyDependencyFilter<T extends IssueRelationLike>(
  issues: T[],
  filter: readonly ("blocked" | "blocking")[] | null,
  allIssues: readonly IssueRelationLike[],
): T[] {
  if (!filter || filter.length === 0) return issues;
  // Multi-select (REEF-031): keep an issue if it satisfies ANY selected relation.
  const wantBlocked = filter.includes("blocked");
  const wantBlocking = filter.includes("blocking");
  return issues.filter(
    (issue) =>
      (wantBlocked && isBlocked(issue, allIssues)) ||
      (wantBlocking && isBlocking(issue, allIssues)),
  );
}
