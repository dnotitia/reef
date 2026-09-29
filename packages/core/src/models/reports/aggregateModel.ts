import type { IssueListItem, Status } from "../../schemas/issues/metadata";
import { isResolvedStatus, ACTIVE_STATUSES } from "../status";
import { matchesSharedFacets, isIssueActive } from "../sharedIssueFacets";
import type {
  AgingBucketKey,
  ReportAggregates,
  ReportFilters,
  ReportMeasure,
  ReportPeriod,
  ReportScope,
  RiskPriority,
} from "../../schemas/reports";
import { PRIORITY_OPTIONS } from "../../schemas/issues/fieldRegistry";

export type {
  AgingBucketKey,
  AgingBuckets,
  DueHealth,
  FlowMetricKind,
  FlowMetricPoint,
  FlowMetricResult,
  FlowMetrics,
  FlowPercentiles,
  NamedCount,
  NetThroughputWeek,
  PriorityCount,
  ReportAggregates,
  ReportFilters,
  ReportKpis,
  ReportMeasure,
  ReportPeriod,
  ReportScope,
  RiskBucket,
  RiskPriority,
  RiskSummary,
  SeverityCount,
  StatusCount,
  ThroughputWeek,
  TypeCount,
} from "../../schemas/reports";

const ACTIVE_STATUS_SET: ReadonlySet<Status> = new Set(ACTIVE_STATUSES);

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  period: "12w",
  scope: "active",
  measure: "count",
};

export interface AggregateOptions {
  assigneeLimit?: number;
  labelLimit?: number;
  filters?: ReportFilters;
  now?: number;
  throughputWeeks?: number;
}

export interface FlowMetricsOptions {
  filters?: ReportFilters;
  now?: number;
}

export type StatusActivityEvent = Extract<
  import("../../schemas/issues/activity").ActivityEvent,
  { event_type: "status_change" }
>;

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

export const ISSUE_TYPE_OPTIONS = [
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

export function reportPeriodWindow(
  period: ReportPeriod,
  now: number,
): { start: number; end: number } {
  const end = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
  if (period === "all") return { start: Number.NEGATIVE_INFINITY, end };
  return {
    start: end - REPORT_PERIOD_WEEKS[period] * WEEK_MS,
    end,
  };
}

export function nearestRankPercentile(
  values: ReadonlyArray<number>,
  percentile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1] ?? null;
}

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

export const SEVERITY_OPTIONS = [
  "blocker",
  "critical",
  "major",
  "minor",
  "trivial",
] as const;

export function isOpenReportWork(issue: IssueListItem): boolean {
  return ACTIVE_STATUS_SET.has(issue.status);
}

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
  if (filters.scope === "active" && !isIssueActive(issue)) return false;
  if (
    filters.scope === "completed" &&
    (!isIssueActive(issue) || !isResolvedStatus(issue.status))
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

export interface Tally {
  count: number;
  points: number;
}

export function tally<K>(map: Map<K, Tally>, key: K, pts: number): void {
  const cur = map.get(key);
  if (cur) {
    cur.count += 1;
    cur.points += pts;
  } else {
    map.set(key, { count: 1, points: pts });
  }
}

export function rankAndTake(
  buckets: Map<string, Tally>,
  limit: number,
  measure: ReportMeasure,
): ReportAggregates["topAssignees"] {
  return Array.from(buckets.entries())
    .map(([name, { count, points }]) => ({ name, count, points }))
    .sort(
      (a, b) =>
        (measure === "points" ? b.points - a.points : b.count - a.count) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit);
}
