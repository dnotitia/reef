import { PRIORITY_OPTIONS } from "@/components/ui/priority-dot";
import {
  isActive,
  matchesSharedFacets,
} from "@/features/issues/lib/issueListUtils";
import {
  ACTIVE_STATUSES,
  type IssueListItem,
  type IssueType,
  type Priority,
  type Severity,
  type Status,
  isResolvedStatus,
} from "@reef/core";

/** O(1) membership for the active lifecycle statuses (open/in_progress/
 *  in_review). Excludes `backlog` (uncommitted) and resolved states, so health
 *  metrics ignore both (REEF-109). */
const ACTIVE_STATUS_SET: ReadonlySet<Status> = new Set(ACTIVE_STATUSES);

/** Every distribution bucket carries both a `count` (issues) and `points`
 *  (sum of `estimate_points`, treating a missing estimate as 0 so the toggled
 *  population stays identical — REEF-188 AC3). The active `measure` selects
 *  which one a card renders and which one ranked lists sort by. */
export interface StatusCount {
  status: Status;
  count: number;
  points: number;
}

export interface PriorityCount {
  priority: Priority | "none";
  count: number;
  points: number;
}

export interface NamedCount {
  name: string;
  count: number;
  points: number;
}

export interface TypeCount {
  type: IssueType;
  count: number;
  points: number;
}

export interface SeverityCount {
  severity: Severity;
  count: number;
  points: number;
}

export type ReportPeriod = "4w" | "12w" | "quarter" | "all";
export type ReportScope = "active" | "all" | "completed";

/** How distribution and throughput cards measure work: by issue `count`
 *  (default) or by summed story `points` (REEF-188). A measure, not a
 *  population filter — it never narrows which issues are aggregated. */
export type ReportMeasure = "count" | "points";

export interface ReportFilters {
  period: ReportPeriod;
  scope: ReportScope;
  /** Count (default) vs. sum-of-estimates weighting for the load/throughput
   *  cards. Threaded like period/scope; it changes how buckets are measured and
   *  how ranked lists sort, never the matched population (REEF-188). */
  measure: ReportMeasure;
  sprint_id?: string;
  milestone_id?: string;
  release_id?: string;
  /** Set only by the portfolio rollup's parent drill (REEF-187); no scope-bar
   *  control. Shares the exact-id `matchesSharedFacets` predicate. */
  parent_id?: string;
  assignee?: string;
  label?: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  period: "12w",
  scope: "active",
  measure: "count",
};

/** Top-line health numbers, all scoped to active issues. `inProgress` folds
 *  in_progress + in_review; `done` folds done + closed. `overdue` / `blocked`
 *  / `unassigned` count just *open work* (status not done/closed). */
export interface ReportKpis {
  active: number;
  inProgress: number;
  done: number;
  overdue: number;
  blocked: number;
  unassigned: number;
}

/** One rolling 7-day window. `created` counts issues whose `created_at` falls
 *  in the window; `closed` counts completion events (`closed_at`, else
 *  `last_status_change`/`updated_at` for done|closed issues). */
export interface ThroughputWeek {
  start: string; // ISO date at window start (UTC)
  label: string; // e.g. "Apr 13"
  created: number;
  closed: number;
  createdPoints: number; // sum of estimate_points for issues created in window
  closedPoints: number; // sum of estimate_points for issues closed in window
}

export interface NetThroughputWeek extends ThroughputWeek {
  net: number;
  netPoints: number;
}

/** Deadline posture for active open work. `noDueDate` is the share of open
 *  work with no `due_date` set at all. */
export interface DueHealth {
  overdue: number;
  dueThisWeek: number;
  upcoming: number;
  noDueDate: number;
}

/** Active open work bucketed by time since `updated_at` — surfaces stall. */
export interface AgingBuckets {
  fresh: number; // < 7d
  recent: number; // 7–14d
  stale: number; // 14–30d
  stalled: number; // > 30d
}

export type AgingBucketKey = keyof AgingBuckets;
export type RiskPriority = Priority | "none";

export interface RiskBucket {
  priority: RiskPriority;
  aging: AgingBucketKey;
  count: number;
}

export interface RiskSummary {
  atRisk: number;
  overdue: number;
  stale: number;
  blocked: number;
  critical: number;
  netThroughput: number;
}

export interface ReportAggregates {
  filteredTotal: number;
  total: number;
  byStatus: StatusCount[];
  byPriority: PriorityCount[];
  topAssignees: NamedCount[];
  topLabels: NamedCount[];
  kpis: ReportKpis;
  byType: TypeCount[];
  bySeverity: SeverityCount[];
  throughput: ThroughputWeek[];
  netThroughput: NetThroughputWeek[];
  dueHealth: DueHealth;
  aging: AgingBuckets;
  riskSummary: RiskSummary;
  riskMatrix: RiskBucket[];
}

export interface AggregateOptions {
  assigneeLimit?: number;
  labelLimit?: number;
  filters?: ReportFilters;
  /** Reference "now" (ms epoch) for time-based buckets — injectable for tests.
   *  Defaults to Date.now(). */
  now?: number;
  /** Number of trailing weeks in the throughput series. */
  throughputWeeks?: number;
}

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export const ISSUE_TYPE_OPTIONS: readonly IssueType[] = [
  "epic",
  "story",
  "task",
  "bug",
  "spike",
  "chore",
] as const;

export const REPORT_PERIOD_WEEKS: Record<
  Exclude<ReportPeriod, "all">,
  number
> = {
  "4w": 4,
  "12w": 12,
  quarter: 13,
};

/** Display labels for the throughput period control — the single source the
 *  scope-bar option and the Throughput card window subtitle both read, so the
 *  period the user picks reads the same on the control and on the one card it
 *  re-scopes (REEF-185). */
export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  "4w": "Last 4 weeks",
  "12w": "Last 12 weeks",
  quarter: "Quarter",
  all: "All time",
};

export const RISK_PRIORITIES: readonly RiskPriority[] = [
  "critical",
  "high",
  "medium",
  "low",
  "none",
] as const;

export const AGING_BUCKETS: readonly AgingBucketKey[] = [
  "fresh",
  "recent",
  "stale",
  "stalled",
] as const;

export const SEVERITY_OPTIONS: readonly Severity[] = [
  "blocker",
  "critical",
  "major",
  "minor",
  "trivial",
] as const;

export const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function isOpenReportWork(issue: IssueListItem): boolean {
  return ACTIVE_STATUS_SET.has(issue.status);
}

/** Completion timestamp (ms) for throughput, or null if the issue isn't done.
 *  Prefers explicit `closed_at`, falls back to `last_status_change`/`updated_at`
 *  for done|closed issues so the series stays useful when `closed_at` is unset. */
export function completionTime(issue: IssueListItem): number | null {
  if (issue.closed_at) return Date.parse(issue.closed_at);
  if (isResolvedStatus(issue.status)) {
    return Date.parse(issue.last_status_change ?? issue.updated_at);
  }
  return null;
}

export function matchesFilters(
  issue: IssueListItem,
  filters: ReportFilters,
): boolean {
  // Reports scope: active hides archived; completed keeps just resolved
  // active work. The remaining facets (assignee/label/sprint/milestone/release)
  // share one predicate with the issues list so semantics does not diverge
  // (REEF-074).
  if (filters.scope === "active" && !isActive(issue)) return false;
  if (
    filters.scope === "completed" &&
    (!isActive(issue) || !isResolvedStatus(issue.status))
  ) {
    return false;
  }
  return matchesSharedFacets(issue, filters);
}

export function ageBucket(ageDays: number): AgingBucketKey {
  if (ageDays < 7) return "fresh";
  if (ageDays < 14) return "recent";
  if (ageDays < 30) return "stale";
  return "stalled";
}

export function isCriticalRisk(issue: IssueListItem): boolean {
  return (
    issue.priority === "critical" ||
    issue.severity === "blocker" ||
    issue.severity === "critical"
  );
}

/** A bucket that accrues both an issue count and a point sum in one pass. */
export interface Tally {
  count: number;
  points: number;
}

/** Add one issue worth `pts` points to a bucket, creating it on first sight.
 *  Works for both pre-seeded (status/priority/...) and dynamic
 *  (assignee/label) maps. */
export function tally<K>(map: Map<K, Tally>, key: K, pts: number): void {
  const cur = map.get(key);
  if (cur) {
    cur.count += 1;
    cur.points += pts;
  } else {
    map.set(key, { count: 1, points: pts });
  }
}

/** Rank named buckets by the active measure (desc), breaking ties by name
 *  (asc), then take the top `limit`. The unranked measure rides along on each
 *  row so a "show both" view never needs a recompute. */
export function rankAndTake(
  buckets: Map<string, Tally>,
  limit: number,
  measure: ReportMeasure,
): NamedCount[] {
  return Array.from(buckets.entries())
    .map(([name, { count, points }]) => ({ name, count, points }))
    .sort(
      (a, b) =>
        (measure === "points" ? b.points - a.points : b.count - a.count) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
