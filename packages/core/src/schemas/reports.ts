import { z } from "zod";
import {
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./issues/metadata";

export const ReportPeriodSchema = z.enum(["4w", "12w", "quarter", "all"]);
export const ReportScopeSchema = z.enum(["active", "all", "completed"]);
export const ReportMeasureSchema = z.enum(["count", "points"]);
export const RollupDimensionSchema = z.enum([
  "milestone",
  "sprint",
  "release",
  "parent",
]);
export const PivotFieldSchema = z.enum([
  "status",
  "type",
  "priority",
  "severity",
  "assignee",
  "label",
]);

export const ReportFiltersSchema = z.object({
  period: ReportPeriodSchema.default("12w"),
  scope: ReportScopeSchema.default("active"),
  measure: ReportMeasureSchema.default("count"),
  sprint_id: z.string().optional(),
  milestone_id: z.string().optional(),
  release_id: z.string().optional(),
  parent_id: z.string().optional(),
  assignee: z.string().optional(),
  label: z.string().optional(),
});

export const ReportRequestSchema = z
  .object({
    filters: ReportFiltersSchema.default({
      period: "12w",
      scope: "active",
      measure: "count",
    }),
    asOf: z.number().int().nonnegative(),
    rollupDimension: RollupDimensionSchema.default("milestone"),
    pivotRow: PivotFieldSchema.default("assignee"),
    pivotCol: PivotFieldSchema.default("status"),
  })
  .strict()
  .refine((request) => request.pivotRow !== request.pivotCol, {
    path: ["pivotCol"],
    message: "Pivot axes must use different fields",
  });

const CountPairSchema = z.object({
  count: z.number(),
  points: z.number(),
});

export const StatusCountSchema = CountPairSchema.extend({ status: StatusEnum });
export const PriorityCountSchema = CountPairSchema.extend({
  priority: PriorityEnum.or(z.literal("none")),
});
export const NamedCountSchema = CountPairSchema.extend({ name: z.string() });
export const TypeCountSchema = CountPairSchema.extend({ type: IssueTypeEnum });
export const SeverityCountSchema = CountPairSchema.extend({
  severity: SeverityEnum,
});

export const ThroughputWeekSchema = z.object({
  start: z.string(),
  created: z.number(),
  closed: z.number(),
  createdPoints: z.number(),
  closedPoints: z.number(),
});

export const NetThroughputWeekSchema = ThroughputWeekSchema.extend({
  net: z.number(),
  netPoints: z.number(),
});

export const ReportAggregatesSchema = z.object({
  filteredTotal: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  byStatus: z.array(StatusCountSchema),
  byPriority: z.array(PriorityCountSchema),
  topAssignees: z.array(NamedCountSchema),
  topLabels: z.array(NamedCountSchema),
  kpis: z.object({
    active: z.number(),
    inProgress: z.number(),
    done: z.number(),
    overdue: z.number(),
    blocked: z.number(),
    unassigned: z.number(),
  }),
  byType: z.array(TypeCountSchema),
  bySeverity: z.array(SeverityCountSchema),
  throughput: z.array(ThroughputWeekSchema),
  netThroughput: z.array(NetThroughputWeekSchema),
  dueHealth: z.object({
    overdue: z.number(),
    dueThisWeek: z.number(),
    upcoming: z.number(),
    noDueDate: z.number(),
  }),
  aging: z.object({
    fresh: z.number(),
    recent: z.number(),
    stale: z.number(),
    stalled: z.number(),
  }),
  riskSummary: z.object({
    atRisk: z.number(),
    overdue: z.number(),
    stale: z.number(),
    blocked: z.number(),
    critical: z.number(),
    netThroughput: z.number(),
  }),
  riskMatrix: z.array(
    z.object({
      priority: PriorityEnum.or(z.literal("none")),
      aging: z.enum(["fresh", "recent", "stale", "stalled"]),
      count: z.number(),
    }),
  ),
});

export const FlowMetricPointSchema = z.object({
  issueId: z.string(),
  title: z.string(),
  completionAt: z.string(),
  elapsedDays: z.number(),
});

export const FlowMetricResultSchema = z.object({
  completionWindowCount: z.number(),
  measuredCount: z.number(),
  coveragePercent: z.number(),
  points: z.array(FlowMetricPointSchema),
  percentiles: z
    .object({ p50: z.number(), p85: z.number(), p95: z.number() })
    .nullable(),
  sleDays: z.number().nullable(),
  lowSample: z.boolean(),
  outliers: z.array(FlowMetricPointSchema),
});

export const FlowMetricsSchema = z.object({
  cycle: FlowMetricResultSchema,
  lead: FlowMetricResultSchema,
});

const HealthVerdictSchema = z.object({
  level: z.enum(["off_track", "at_risk", "on_track"]),
  reason: z.object({
    code: z.enum([
      "pastTarget",
      "overduePastMidpoint",
      "wellBehind",
      "overdue",
      "blocked",
      "behindSchedule",
      "backlogOver",
      "onTrack",
      "shipped",
    ]),
    count: z.number().optional(),
  }),
});

export const HealthRollupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: RollupDimensionSchema,
  shipped: z.boolean(),
  targetDate: z.string().nullable(),
  total: z.number(),
  resolved: z.number(),
  open: z.number(),
  overdue: z.number(),
  blocked: z.number(),
  net: z.number(),
  completion: z.number(),
  verdict: HealthVerdictSchema.nullable(),
});

export const ForecastSchema = z.object({
  remaining: z.number(),
  horizonWeeks: z.number(),
  sampleWeeks: z.number(),
  totalThroughput: z.number(),
  productiveWeeks: z.number(),
  lowConfidence: z.boolean(),
  insufficient: z.boolean(),
  completion: z.array(
    z.object({
      confidence: z.union([
        z.literal(50),
        z.literal(70),
        z.literal(85),
        z.literal(95),
      ]),
      weeks: z.number(),
      capped: z.boolean(),
    }),
  ),
  byDate: z.array(
    z.object({
      confidence: z.union([
        z.literal(50),
        z.literal(70),
        z.literal(85),
        z.literal(95),
      ]),
      count: z.number(),
    }),
  ),
});

export const PivotAxisSchema = z.object({ key: z.string() });
export const PivotCellSchema = z.object({
  rowKey: z.string(),
  colKey: z.string(),
  count: z.number(),
});
export const PivotTotalSchema = z.object({
  key: z.string(),
  total: z.number(),
});

export const PivotResultSchema = z.object({
  rowField: PivotFieldSchema,
  colField: PivotFieldSchema,
  rows: z.array(PivotAxisSchema),
  cols: z.array(PivotAxisSchema),
  cells: z.array(PivotCellSchema),
  rowTotals: z.array(PivotTotalSchema),
  colTotals: z.array(PivotTotalSchema),
  grandTotal: z.number(),
  max: z.number(),
  rowsFolded: z.number(),
  colsFolded: z.number(),
});

export const ReportResponseSchema = z.object({
  asOf: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
  parentName: z.string().nullable(),
  availableDimensions: z.array(RollupDimensionSchema),
  rollupDimension: RollupDimensionSchema,
  aggregates: ReportAggregatesSchema,
  flowMetrics: FlowMetricsSchema,
  forecast: ForecastSchema,
  healthRollup: z.array(HealthRollupRowSchema),
  pivot: PivotResultSchema,
});

export type ReportPeriod = z.infer<typeof ReportPeriodSchema>;
export type ReportScope = z.infer<typeof ReportScopeSchema>;
export type ReportMeasure = z.infer<typeof ReportMeasureSchema>;
export type ReportFilters = z.infer<typeof ReportFiltersSchema>;
export type RollupDimension = z.infer<typeof RollupDimensionSchema>;
export type PivotFieldKey = z.infer<typeof PivotFieldSchema>;
export type ReportRequest = z.infer<typeof ReportRequestSchema>;
export type ReportAggregates = z.infer<typeof ReportAggregatesSchema>;
export type StatusCount = z.infer<typeof StatusCountSchema>;
export type PriorityCount = z.infer<typeof PriorityCountSchema>;
export type NamedCount = z.infer<typeof NamedCountSchema>;
export type TypeCount = z.infer<typeof TypeCountSchema>;
export type SeverityCount = z.infer<typeof SeverityCountSchema>;
export type ReportKpis = ReportAggregates["kpis"];
export type ThroughputWeek = z.infer<typeof ThroughputWeekSchema>;
export type NetThroughputWeek = z.infer<typeof NetThroughputWeekSchema>;
export type DueHealth = ReportAggregates["dueHealth"];
export type AgingBuckets = ReportAggregates["aging"];
export type AgingBucketKey = keyof AgingBuckets;
export type RiskPriority = PriorityCount["priority"];
export type RiskBucket = ReportAggregates["riskMatrix"][number];
export type RiskSummary = ReportAggregates["riskSummary"];
export type FlowMetricPoint = z.infer<typeof FlowMetricPointSchema>;
export type FlowMetricResult = z.infer<typeof FlowMetricResultSchema>;
export type FlowMetricKind = "cycle" | "lead";
export type FlowPercentiles = NonNullable<FlowMetricResult["percentiles"]>;
export type FlowMetrics = z.infer<typeof FlowMetricsSchema>;
export type HealthRollupRow = z.infer<typeof HealthRollupRowSchema>;
export type Forecast = z.infer<typeof ForecastSchema>;
export type PivotResult = z.infer<typeof PivotResultSchema>;
export type PivotAxis = z.infer<typeof PivotAxisSchema>;
export type PivotCell = z.infer<typeof PivotCellSchema>;
export type PivotTotal = z.infer<typeof PivotTotalSchema>;
export type ReportResponse = z.infer<typeof ReportResponseSchema>;
