import { PRIORITY_OPTIONS } from "@/components/ui/priority-dot";
import { STATUS_OPTIONS } from "@/components/ui/status-icon";
import {
  indexIssuesById,
  unresolvedBlockerCountIn,
} from "@/features/issues/lib/dependencyUtils";
import { isActive } from "@/features/issues/lib/issueListUtils";
import {
  type IssueListItem,
  type IssueType,
  type Priority,
  type Severity,
  type Status,
  isResolvedStatus,
} from "@reef/core";
import {
  AGING_BUCKETS,
  type AggregateOptions,
  type AgingBuckets,
  DAY_MS,
  DEFAULT_REPORT_FILTERS,
  type DueHealth,
  ISSUE_TYPE_OPTIONS,
  MONTHS,
  type NamedCount,
  REPORT_PERIOD_WEEKS,
  RISK_PRIORITIES,
  type ReportAggregates,
  type ReportKpis,
  type RiskSummary,
  SEVERITY_OPTIONS,
  type ThroughputWeek,
  WEEK_MS,
  ageBucket,
  completionTime,
  isCriticalRisk,
  isOpenReportWork,
  matchesFilters,
  rankAndTake,
} from "./aggregateModel";

export {
  DEFAULT_REPORT_FILTERS,
  type AggregateOptions,
  type AgingBucketKey,
  type AgingBuckets,
  type DueHealth,
  type NamedCount,
  type NetThroughputWeek,
  type PriorityCount,
  type ReportAggregates,
  type ReportFilters,
  type ReportKpis,
  type ReportPeriod,
  type ReportScope,
  type RiskBucket,
  type RiskPriority,
  type RiskSummary,
  type SeverityCount,
  type StatusCount,
  type ThroughputWeek,
  type TypeCount,
} from "./aggregateModel";

/** Single-pass aggregation. Named buckets sort count-desc, then name-asc
 *  for stable rendering. Priority appends a trailing `"none"` bucket. */
export function computeAggregates(
  issues: ReadonlyArray<IssueListItem>,
  options: AggregateOptions = {},
): ReportAggregates {
  const {
    assigneeLimit = 5,
    labelLimit = 8,
    filters = DEFAULT_REPORT_FILTERS,
    now = Date.now(),
    throughputWeeks = filters.period === "all"
      ? 26
      : REPORT_PERIOD_WEEKS[filters.period],
  } = options;

  const filteredIssues = issues.filter((issue) =>
    matchesFilters(issue, filters),
  );
  const dependencyIndex = indexIssuesById(issues);
  const statusBuckets = new Map<Status, number>(
    STATUS_OPTIONS.map((s) => [s, 0]),
  );
  const priorityBuckets = new Map<Priority | "none", number>([
    ...PRIORITY_OPTIONS.map((p) => [p, 0] as const),
    ["none", 0],
  ]);
  const typeBuckets = new Map<IssueType, number>(
    ISSUE_TYPE_OPTIONS.map((t) => [t, 0]),
  );
  const severityBuckets = new Map<Severity, number>(
    SEVERITY_OPTIONS.map((s) => [s, 0]),
  );
  const assigneeBuckets = new Map<string, number>();
  const labelBuckets = new Map<string, number>();
  const riskBuckets = new Map<string, number>(
    RISK_PRIORITIES.flatMap((priority) =>
      AGING_BUCKETS.map((aging) => [`${priority}:${aging}`, 0] as const),
    ),
  );

  const kpis: ReportKpis = {
    active: 0,
    inProgress: 0,
    done: 0,
    overdue: 0,
    blocked: 0,
    unassigned: 0,
  };
  const dueHealth: DueHealth = {
    overdue: 0,
    dueThisWeek: 0,
    upcoming: 0,
    noDueDate: 0,
  };
  const aging: AgingBuckets = { fresh: 0, recent: 0, stale: 0, stalled: 0 };
  const riskSummary: RiskSummary = {
    atRisk: 0,
    overdue: 0,
    stale: 0,
    blocked: 0,
    critical: 0,
    netThroughput: 0,
  };

  // Throughput windows: `throughputWeeks` rolling 7-day buckets ending at the
  // end of "today" (UTC), oldest first.
  const todayEnd = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
  const seriesStart = todayEnd - throughputWeeks * WEEK_MS;
  const throughput: ThroughputWeek[] = Array.from(
    { length: throughputWeeks },
    (_, k) => {
      const start = seriesStart + k * WEEK_MS;
      const d = new Date(start);
      return {
        start: new Date(start).toISOString(),
        label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
        created: 0,
        closed: 0,
      };
    },
  );
  const windowIndex = (t: number): number => {
    if (Number.isNaN(t) || t < seriesStart || t >= todayEnd) return -1;
    return Math.min(
      throughputWeeks - 1,
      Math.floor((t - seriesStart) / WEEK_MS),
    );
  };

  const weekFromNow = now + WEEK_MS;
  let total = 0;

  for (const issue of filteredIssues) {
    // Throughput is historical — count creation/completion regardless of the
    // issue's current active/archived state.
    const createdIdx = windowIndex(Date.parse(issue.created_at));
    if (createdIdx >= 0) throughput[createdIdx].created++;
    const completedAt = completionTime(issue);
    if (completedAt != null) {
      const closedIdx = windowIndex(completedAt);
      if (closedIdx >= 0) throughput[closedIdx].closed++;
    }

    if (filters.scope !== "all" && !isActive(issue)) continue;
    total++;
    kpis.active++;

    statusBuckets.set(issue.status, (statusBuckets.get(issue.status) ?? 0) + 1);
    if (issue.status === "in_progress" || issue.status === "in_review") {
      kpis.inProgress++;
    }
    if (isResolvedStatus(issue.status)) kpis.done++;

    const prioKey: Priority | "none" = issue.priority ?? "none";
    priorityBuckets.set(prioKey, (priorityBuckets.get(prioKey) ?? 0) + 1);

    // Mirror filterIssues: a missing issue_type is treated as "task" so the
    // donut total matches the active-issue count even for older/cached data.
    const issueType = issue.issue_type ?? "task";
    typeBuckets.set(issueType, (typeBuckets.get(issueType) ?? 0) + 1);
    if (issue.severity) {
      severityBuckets.set(
        issue.severity,
        (severityBuckets.get(issue.severity) ?? 0) + 1,
      );
    }

    const assigneeName = issue.assigned_to?.trim() || "Unassigned";
    assigneeBuckets.set(
      assigneeName,
      (assigneeBuckets.get(assigneeName) ?? 0) + 1,
    );
    for (const label of issue.labels ?? []) {
      const name = label.trim();
      if (!name) continue;
      labelBuckets.set(name, (labelBuckets.get(name) ?? 0) + 1);
    }

    // Health metrics — open work just.
    if (filters.scope !== "completed" && isOpenReportWork(issue)) {
      if (!issue.assigned_to?.trim()) kpis.unassigned++;
      const blocked = unresolvedBlockerCountIn(issue, dependencyIndex) > 0;
      if (blocked) {
        kpis.blocked++;
        riskSummary.blocked++;
      }

      if (issue.due_date) {
        const due = Date.parse(issue.due_date);
        if (due < now) {
          kpis.overdue++;
          dueHealth.overdue++;
          riskSummary.overdue++;
        } else if (due <= weekFromNow) {
          dueHealth.dueThisWeek++;
        } else {
          dueHealth.upcoming++;
        }
      } else {
        dueHealth.noDueDate++;
      }

      const ageDays = (now - Date.parse(issue.updated_at)) / DAY_MS;
      const bucket = ageBucket(ageDays);
      aging[bucket]++;
      if (bucket === "stale" || bucket === "stalled") riskSummary.stale++;

      const priority = issue.priority ?? "none";
      riskBuckets.set(
        `${priority}:${bucket}`,
        (riskBuckets.get(`${priority}:${bucket}`) ?? 0) + 1,
      );

      const critical = isCriticalRisk(issue);
      if (critical) riskSummary.critical++;
      if (
        critical ||
        blocked ||
        bucket === "stale" ||
        bucket === "stalled" ||
        (issue.due_date && Date.parse(issue.due_date) < now)
      ) {
        riskSummary.atRisk++;
      }
    }
  }

  const netThroughput = throughput.map((week) => ({
    ...week,
    net: week.created - week.closed,
  }));
  riskSummary.netThroughput = netThroughput.reduce(
    (sum, week) => sum + week.net,
    0,
  );

  return {
    filteredTotal: filteredIssues.length,
    total,
    byStatus: STATUS_OPTIONS.map((status) => ({
      status,
      count: statusBuckets.get(status) ?? 0,
    })),
    byPriority: [
      ...PRIORITY_OPTIONS.map((priority) => ({
        priority,
        count: priorityBuckets.get(priority) ?? 0,
      })),
      { priority: "none" as const, count: priorityBuckets.get("none") ?? 0 },
    ],
    topAssignees: rankAndTake(assigneeBuckets, assigneeLimit),
    topLabels: rankAndTake(labelBuckets, labelLimit),
    kpis,
    byType: ISSUE_TYPE_OPTIONS.map((type) => ({
      type,
      count: typeBuckets.get(type) ?? 0,
    })).filter((b) => b.count > 0),
    bySeverity: SEVERITY_OPTIONS.map((severity) => ({
      severity,
      count: severityBuckets.get(severity) ?? 0,
    })).filter((b) => b.count > 0),
    throughput,
    netThroughput,
    dueHealth,
    aging,
    riskSummary,
    riskMatrix: RISK_PRIORITIES.flatMap((priority) =>
      AGING_BUCKETS.map((aging) => ({
        priority,
        aging,
        count: riskBuckets.get(`${priority}:${aging}`) ?? 0,
      })),
    ),
  };
}
