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
import { PRIORITY_OPTIONS } from "@reef/core/fields";
import { STATUS_OPTIONS } from "@reef/core/fields";
import {
  AGING_BUCKETS,
  type AggregateOptions,
  type AgingBuckets,
  DAY_MS,
  DEFAULT_REPORT_FILTERS,
  type DueHealth,
  ISSUE_TYPE_OPTIONS,
  type NamedCount,
  REPORT_PERIOD_WEEKS,
  RISK_PRIORITIES,
  type ReportAggregates,
  type ReportKpis,
  type ReportMeasure,
  type RiskSummary,
  SEVERITY_OPTIONS,
  type Tally,
  type ThroughputWeek,
  WEEK_MS,
  ageBucket,
  completionTime,
  isCriticalRisk,
  isOpenReportWork,
  matchesFilters,
  rankAndTake,
  tally,
} from "./aggregateModel";

export {
  DEFAULT_REPORT_FILTERS,
  WEEK_MS,
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
  type ReportMeasure,
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

/** Single-pass aggregation. Every distribution bucket carries both an issue
 *  `count` and a story-`points` sum; `filters.measure` selects which one ranked
 *  lists sort by (desc, then name-asc) and which a card renders. Priority
 *  appends a trailing `"none"` bucket. */
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

  const measure: ReportMeasure = filters.measure;
  const filteredIssues = issues.filter((issue) =>
    matchesFilters(issue, filters),
  );
  const dependencyIndex = indexIssuesById(issues);
  // Each bucket accrues a count and a point sum in one pass; the seeded zero
  // buckets give every distribution a fresh, independent Tally per key.
  const seed = <K>(keys: readonly K[]): Map<K, Tally> =>
    new Map(keys.map((k) => [k, { count: 0, points: 0 }]));
  const statusBuckets = seed<Status>(STATUS_OPTIONS);
  const priorityBuckets = seed<Priority | "none">([
    ...PRIORITY_OPTIONS,
    "none",
  ]);
  const typeBuckets = seed<IssueType>(ISSUE_TYPE_OPTIONS);
  const severityBuckets = seed<Severity>(SEVERITY_OPTIONS);
  const assigneeBuckets = new Map<string, Tally>();
  const labelBuckets = new Map<string, Tally>();
  // riskMatrix stays count-(risk posture, not load); leave it a number map.
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
      return {
        start: new Date(start).toISOString(),
        created: 0,
        closed: 0,
        createdPoints: 0,
        closedPoints: 0,
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
    // A missing estimate contributes 0 points, so the count and points views
    // share one population (REEF-188 AC3).
    const pts = issue.estimate_points ?? 0;

    // Throughput is historical — count creation/completion regardless of the
    // issue's current active/archived state.
    const createdIdx = windowIndex(Date.parse(issue.created_at));
    if (createdIdx >= 0) {
      throughput[createdIdx].created++;
      throughput[createdIdx].createdPoints += pts;
    }
    const completedAt = completionTime(issue);
    if (completedAt != null) {
      const closedIdx = windowIndex(completedAt);
      if (closedIdx >= 0) {
        throughput[closedIdx].closed++;
        throughput[closedIdx].closedPoints += pts;
      }
    }

    if (filters.scope !== "all" && !isActive(issue)) continue;
    total++;
    kpis.active++;

    tally(statusBuckets, issue.status, pts);
    if (issue.status === "in_progress" || issue.status === "in_review") {
      kpis.inProgress++;
    }
    if (isResolvedStatus(issue.status)) kpis.done++;

    const prioKey: Priority | "none" = issue.priority ?? "none";
    tally(priorityBuckets, prioKey, pts);

    // Mirror filterIssues: a missing issue_type is treated as "task" so the
    // donut total matches the active-issue count even for older/cached data.
    const issueType = issue.issue_type ?? "task";
    tally(typeBuckets, issueType, pts);
    if (issue.severity) tally(severityBuckets, issue.severity, pts);

    const assigneeName = issue.assigned_to?.trim() || "Unassigned";
    tally(assigneeBuckets, assigneeName, pts);
    for (const label of issue.labels ?? []) {
      const name = label.trim();
      if (!name) continue;
      tally(labelBuckets, name, pts);
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
    netPoints: week.createdPoints - week.closedPoints,
  }));
  riskSummary.netThroughput = netThroughput.reduce(
    (sum, week) => sum + week.net,
    0,
  );

  const ZERO: Tally = { count: 0, points: 0 };
  return {
    filteredTotal: filteredIssues.length,
    total,
    byStatus: STATUS_OPTIONS.map((status) => {
      const t = statusBuckets.get(status) ?? ZERO;
      return { status, count: t.count, points: t.points };
    }),
    byPriority: [...PRIORITY_OPTIONS, "none" as const].map((priority) => {
      const t = priorityBuckets.get(priority) ?? ZERO;
      return { priority, count: t.count, points: t.points };
    }),
    topAssignees: rankAndTake(assigneeBuckets, assigneeLimit, measure),
    topLabels: rankAndTake(labelBuckets, labelLimit, measure),
    kpis,
    byType: ISSUE_TYPE_OPTIONS.map((type) => {
      const t = typeBuckets.get(type) ?? ZERO;
      return { type, count: t.count, points: t.points };
    }).filter((b) => b.count > 0),
    bySeverity: SEVERITY_OPTIONS.map((severity) => {
      const t = severityBuckets.get(severity) ?? ZERO;
      return { severity, count: t.count, points: t.points };
    }).filter((b) => b.count > 0),
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
