import {
  type IssueRelationLike,
  indexIssuesById,
  unresolvedBlockerCountIn,
} from "@/features/issues/lib/dependencyUtils";
import {
  type IssueListItem,
  type Sprint,
  type Status,
  isResolvedStatus,
} from "@reef/core";

/**
 * My Work — pure derivation for the personal `/my-work` view (REEF-181).
 *
 * One pass over the current user's assigned issues produces (a) the summary
 * counts shown above the queue and (b) the focus-sorted open work queue. Kept
 * framework-free so the AC checks run as plain unit tests; the page component
 * feeds it `Date.now()` and the relation graph.
 */

/** Deadline state of an open item relative to "now" (AC3). */
export type DueState = "overdue" | "due_soon" | "none";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The open (unresolved) statuses My Work scopes to, in lifecycle order — used as
 * the status-distribution segment order (AC2). Excludes the resolved
 * `done`/`closed` states; those feed the sprint completion tally (AC5).
 */
const MY_WORK_OPEN_STATUSES: readonly Status[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
] as const;

/**
 * Queue grouping / tie-break order by proximity to "actively doing" (AC6): work
 * you are already holding outranks cold work at equal urgency and priority.
 */
const STATUS_PROXIMITY: Record<Status, number> = {
  in_progress: 0,
  in_review: 1,
  todo: 2,
  backlog: 3,
  done: 4,
  closed: 5,
};

/** Higher = more urgent. Mirrors the list/board priority rank. */
const PRIORITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Lower sorts first — overdue ahead of due-soon ahead of the rest (AC6). */
const URGENCY_RANK: Record<DueState, number> = {
  overdue: 0,
  due_soon: 1,
  none: 2,
};

/**
 * Classify an issue's deadline. Mirrors the `due` facet rule in `filterIssues`:
 * a resolved or undated issue has no deadline state; otherwise overdue when past
 * due, due-soon within the next 7 days. `now` is injected so the rule is
 * deterministic under test.
 */
export function classifyDue(
  dueDate: string | null | undefined,
  status: Status,
  now: number,
): DueState {
  if (!dueDate || isResolvedStatus(status)) return "none";
  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return "none";
  if (due < now) return "overdue";
  if (due <= now + SEVEN_DAYS_MS) return "due_soon";
  return "none";
}

export interface MyWorkItem {
  issue: IssueListItem;
  dueState: DueState;
  blocked: boolean;
  blockerCount: number;
}

export interface MyWorkSprint {
  sprintId: string;
  name: string;
  /** My open (unresolved) issues committed to the sprint. */
  remaining: number;
  /** My resolved (done/closed) issues in the sprint. */
  done: number;
  total: number;
}

export interface MyWorkSummary {
  /** Open assigned issues — the queue length. */
  open: number;
  byStatus: ReadonlyArray<{ status: Status; count: number }>;
  /** In-progress count (AC4). */
  wip: number;
  overdue: number;
  dueSoon: number;
  /** overdue + due-soon — the single "needs attention" number (AC3). */
  attention: number;
  sprint: MyWorkSprint | null;
}

export interface MyWork {
  /** Open items, focus-sorted (AC6). */
  items: MyWorkItem[];
  summary: MyWorkSummary;
}

/**
 * The vault's current sprint: the lone `active` sprint, or — if several are
 * active — the most recent `start_date`, then the highest `id`. Mirrors the
 * server `getActiveSprint` tie-break so the page and the board agree on "current
 * sprint".
 */
export function selectCurrentSprint(sprints: readonly Sprint[]): Sprint | null {
  let current: Sprint | null = null;
  for (const sprint of sprints) {
    if (sprint.status !== "active") continue;
    if (current === null) {
      current = sprint;
      continue;
    }
    const a = sprint.start_date ?? "";
    const b = current.start_date ?? "";
    if (a !== b ? a > b : sprint.id > current.id) current = sprint;
  }
  return current;
}

/**
 * Focus comparator (AC6): urgency bucket, then nearest deadline within the
 * urgent buckets, then priority, then proximity to active, then recency. Within
 * the non-urgent bucket priority leads — a far-future due date should not float
 * a low-priority item above an undated critical one.
 */
export function compareFocus(a: MyWorkItem, b: MyWorkItem): number {
  const urgency = URGENCY_RANK[a.dueState] - URGENCY_RANK[b.dueState];
  if (urgency !== 0) return urgency;

  // Same bucket. In the urgent buckets every item has a due_date, so the
  // nearest deadline comes first.
  if (a.dueState !== "none") {
    const ad = a.issue.due_date ?? "";
    const bd = b.issue.due_date ?? "";
    if (ad !== bd) return ad < bd ? -1 : 1;
  }

  const priority =
    (PRIORITY_RANK[b.issue.priority ?? ""] ?? 0) -
    (PRIORITY_RANK[a.issue.priority ?? ""] ?? 0);
  if (priority !== 0) return priority;

  const proximity =
    STATUS_PROXIMITY[a.issue.status] - STATUS_PROXIMITY[b.issue.status];
  if (proximity !== 0) return proximity;

  const au = a.issue.updated_at ?? "";
  const bu = b.issue.updated_at ?? "";
  if (au === bu) return 0;
  return au < bu ? 1 : -1;
}

export interface MyWorkGroup {
  status: Status;
  count: number;
  items: MyWorkItem[];
}

/**
 * Partition the (already focus-sorted) items into status groups in proximity
 * order (AC2 "각 status의 목록"). A stable partition, so focus order is
 * preserved within each group; empty groups are dropped.
 */
export function groupByStatus(items: readonly MyWorkItem[]): MyWorkGroup[] {
  const order: readonly Status[] = [
    "in_progress",
    "in_review",
    "todo",
    "backlog",
  ];
  const buckets = new Map<Status, MyWorkItem[]>(order.map((s) => [s, []]));
  for (const item of items) buckets.get(item.issue.status)?.push(item);
  return order
    .map((status) => {
      const groupItems = buckets.get(status) ?? [];
      return { status, count: groupItems.length, items: groupItems };
    })
    .filter((group) => group.count > 0);
}

export interface BuildMyWorkOptions {
  now: number;
  currentSprint?: Sprint | null;
}

/**
 * Single pass over the user's assigned issues. Open items feed the queue and the
 * status/WIP/due counts; resolved items contribute to the current-sprint
 * completion tally (AC5). Archived issues does not count. Blocked state is resolved
 * against the relation `graph` via a prebuilt id index (O(1) per item), so the
 * row gets a primitive `blocked` boolean instead of the whole graph (REEF-097).
 */
export function buildMyWork(
  issues: readonly IssueListItem[],
  graph: readonly IssueRelationLike[],
  options: BuildMyWorkOptions,
): MyWork {
  const { now, currentSprint } = options;
  const currentSprintId = currentSprint?.id ?? null;
  const index = indexIssuesById(graph);
  // Blocked state is trustworthy against the whole-vault relation graph.
  // While that projection is still loading (or failed) the graph is empty —
  // skip blocked rather than mark work blocked from an incomplete graph, since
  // a false "blocked" tells the user to skip actionable work (REEF-181
  // autoreview). A non-empty vault consistently yields a non-empty projection, so an
  // empty graph reliably means "not yet resolvable".
  const canResolveBlocked = graph.length > 0;

  const statusCounts = new Map<Status, number>(
    MY_WORK_OPEN_STATUSES.map((s) => [s, 0]),
  );
  let wip = 0;
  let overdue = 0;
  let dueSoon = 0;
  let sprintRemaining = 0;
  let sprintDone = 0;
  const items: MyWorkItem[] = [];

  for (const issue of issues) {
    if (issue.archived_at != null) continue;
    const resolved = isResolvedStatus(issue.status);

    // Sprint tally spans both sides (AC5), so it runs before the open-gate.
    if (currentSprintId && issue.sprint_id === currentSprintId) {
      if (resolved) sprintDone++;
      else sprintRemaining++;
    }

    if (resolved) continue;

    const dueState = classifyDue(issue.due_date, issue.status, now);
    if (dueState === "overdue") overdue++;
    else if (dueState === "due_soon") dueSoon++;
    if (issue.status === "in_progress") wip++;
    statusCounts.set(issue.status, (statusCounts.get(issue.status) ?? 0) + 1);

    const blockerCount = canResolveBlocked
      ? unresolvedBlockerCountIn(issue, index)
      : 0;
    items.push({
      issue,
      dueState,
      blocked: blockerCount > 0,
      blockerCount,
    });
  }

  items.sort(compareFocus);

  const sprint: MyWorkSprint | null =
    currentSprint && sprintRemaining + sprintDone > 0
      ? {
          sprintId: currentSprint.id,
          name: currentSprint.name,
          remaining: sprintRemaining,
          done: sprintDone,
          total: sprintRemaining + sprintDone,
        }
      : null;

  return {
    items,
    summary: {
      open: items.length,
      byStatus: MY_WORK_OPEN_STATUSES.map((status) => ({
        status,
        count: statusCounts.get(status) ?? 0,
      })),
      wip,
      overdue,
      dueSoon,
      attention: overdue + dueSoon,
      sprint,
    },
  };
}
