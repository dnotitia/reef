import { AuthError, SchemaValidationError } from "../../errors";
import {
  computeFlowMetrics,
  computeForecast,
  computeHealthRollup,
  computePivot,
  DEFAULT_FORECAST_HORIZON_WEEKS,
  distinctParentIds,
} from "../../models/reports";
import { computeAggregatesWithStatusCounts } from "../../models/reports/aggregate";
import { matchesFilters } from "../../models/reports/aggregateModel";
import { ACTIVE_STATUSES } from "../../models/status";
import { STATUS_OPTIONS } from "../../schemas/issues/fieldRegistry";
import { StatusEnum } from "../../schemas/issues/metadata";
import {
  ReportRequestSchema,
  type ReportRequest,
  type StatusCount,
  type ReportResponse,
  ReportResponseSchema,
} from "../../schemas/reports";
import type { IssueListItem } from "../../schemas/issues/metadata";
import { SqlParameterBuilder } from "./core/sql";
import { listReportStatusActivity } from "./issues/activity";
import { rowToIssue } from "./issues/issueRows";
import { listPlanningCatalog } from "./planning/planning";
import type { AkbAdapter } from "./core/http";
import {
  isMissingTableError,
  REEF_ISSUES_TABLE,
  runSql,
  tableRef,
} from "./core/shared";
import { withSpan } from "./core/tracing";

export interface GetReportsParams {
  adapter: AkbAdapter;
  vault: string;
  request: ReportRequest;
}

async function listReportIssues(
  adapter: AkbAdapter,
  vault: string,
  filters: ReportRequest["filters"],
): Promise<{
  issues: IssueListItem[];
  issueCount: number;
  byStatus: StatusCount[];
}> {
  return withSpan("akb.list_report_issues", { vault }, async (span) => {
    let rows: Record<string, unknown>[];
    try {
      const result = await runSql(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(REEF_ISSUES_TABLE)}`,
      );
      rows = result.kind === "table_query" ? result.items : [];
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("table_exists", false);
        return { issues: [], issueCount: 0, byStatus: emptyStatusCounts() };
      }
      throw err;
    }

    const issues: IssueListItem[] = [];
    for (const row of rows) {
      try {
        issues.push(rowToIssue(row));
      } catch {
        // Match the issue-list adapter: malformed projections are skipped alone.
      }
    }
    const byStatus = await aggregateReportStatuses(
      adapter,
      vault,
      issues,
      filters,
    );
    span.setAttribute("row_count", rows.length);
    span.setAttribute("issue_count", issues.length);
    return { issues, issueCount: issues.length, byStatus };
  });
}

function emptyStatusCounts(): StatusCount[] {
  return STATUS_OPTIONS.map((status) => ({ status, count: 0, points: 0 }));
}

function sqlNumber(value: unknown, field: "count" | "points"): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (
    !Number.isFinite(number) ||
    number < 0 ||
    (field === "count" && !Number.isInteger(number))
  ) {
    throw new SchemaValidationError({
      issues: [`Invalid report status aggregate ${field}`],
    });
  }
  return number;
}

async function aggregateReportStatuses(
  adapter: AkbAdapter,
  vault: string,
  issues: ReadonlyArray<IssueListItem>,
  filters: ReportRequest["filters"],
): Promise<StatusCount[]> {
  const params = new SqlParameterBuilder();
  const issueIds = issues
    .filter((issue) => matchesFilters(issue, filters))
    .map((issue) => issue.id);
  const population =
    issueIds.length > 0
      ? `"reef_id" IN (SELECT jsonb_array_elements_text(${params.addJson(
          issueIds,
          "report issue ids",
          "jsonb",
        )}))`
      : "FALSE";
  const result = await runSql(
    adapter,
    vault,
    `SELECT "status", COUNT(*) AS count, COALESCE(SUM("estimate_points"), 0) AS points FROM ${tableRef(
      REEF_ISSUES_TABLE,
    )} WHERE ${population} GROUP BY "status"`,
    params.params,
  );
  if (result.kind !== "table_query") {
    throw new SchemaValidationError({
      issues: ["Report status aggregate did not return rows"],
    });
  }

  const counts = new Map<StatusCount["status"], StatusCount>();
  for (const row of result.items) {
    const status = StatusEnum.safeParse(row.status);
    const count = sqlNumber(row.count, "count");
    const points = sqlNumber(row.points, "points");
    if (!status.success || counts.has(status.data)) {
      throw new SchemaValidationError({
        issues: ["Invalid report status aggregate group"],
      });
    }
    counts.set(status.data, { status: status.data, count, points });
  }
  return STATUS_OPTIONS.map(
    (status) => counts.get(status) ?? { status, count: 0, points: 0 },
  );
}

/** Load AKB report inputs and return only validated, precomputed report data. */
export async function getReports({
  adapter,
  vault,
  request: rawRequest,
}: GetReportsParams): Promise<ReportResponse> {
  const request = ReportRequestSchema.parse(rawRequest);
  return withSpan(
    "akb.get_reports",
    {
      vault,
      period: request.filters.period,
      scope: request.filters.scope,
      measure: request.filters.measure,
      pivot_row: request.pivotRow,
      pivot_col: request.pivotCol,
      rollup_dimension: request.rollupDimension,
    },
    async (span) => {
      const [issueResult, activityResult, planningResult] = await Promise.all([
        listReportIssues(adapter, vault, request.filters),
        listReportStatusActivity(adapter, vault).then(
          (events) => ({ events, unavailable: false }),
          (err: unknown) => {
            if (err instanceof AuthError) throw err;
            return { events: [], unavailable: true };
          },
        ),
        listPlanningCatalog({ adapter, vault }).then(
          (catalog) => ({ catalog, unavailable: false }),
          (err: unknown) => {
            if (err instanceof AuthError) throw err;
            return {
              catalog: {
                sprints: [],
                milestones: [],
                releases: [],
                rollover_resumes: [],
              },
              unavailable: true,
            };
          },
        ),
      ]);
      const { issues, issueCount, byStatus } = issueResult;
      const activity = activityResult.events;
      const { catalog } = planningResult;

      const now = request.asOf;
      const aggregates = computeAggregatesWithStatusCounts(
        issues,
        { filters: request.filters, now },
        byStatus,
      );
      const flowMetrics = computeFlowMetrics(issues, activity, {
        filters: request.filters,
        now,
      });
      const remaining = aggregates.byStatus
        .filter((bucket) => ACTIVE_STATUSES.includes(bucket.status))
        .reduce((sum, bucket) => sum + bucket.count, 0);
      const forecast = computeForecast({
        remaining,
        weeklyThroughput: aggregates.throughput.map((week) => week.closed),
        horizonWeeks: DEFAULT_FORECAST_HORIZON_WEEKS,
      });
      const availableDimensions = planningResult.unavailable
        ? []
        : [
            ...(catalog.milestones.length > 0 ? (["milestone"] as const) : []),
            ...(catalog.sprints.length > 0 ? (["sprint"] as const) : []),
            ...(catalog.releases.length > 0 ? (["release"] as const) : []),
            ...(distinctParentIds(issues).length > 0
              ? (["parent"] as const)
              : []),
          ];
      const rollupDimension = availableDimensions.includes(
        request.rollupDimension,
      )
        ? request.rollupDimension
        : (availableDimensions[0] ?? request.rollupDimension);
      const healthRollup = computeHealthRollup(issues, {
        dimension: rollupDimension,
        catalog,
        filters: request.filters,
        now,
      });
      const pivot = computePivot(issues, request.pivotRow, request.pivotCol, {
        filters: request.filters,
      });
      const parentName = request.filters.parent_id
        ? (issues.find((issue) => issue.id === request.filters.parent_id)
            ?.title ?? request.filters.parent_id)
        : null;

      const result = {
        asOf: request.asOf,
        issueCount,
        parentName,
        availableDimensions,
        rollupDimension,
        aggregates,
        flowMetrics,
        flowMetricsUnavailable: activityResult.unavailable,
        forecast,
        healthRollup,
        pivot,
      };
      try {
        const response = ReportResponseSchema.parse(result);
        span.setAttribute("issue_count", issues.length);
        span.setAttribute("activity_count", activity.length);
        span.setAttribute("activity_available", !activityResult.unavailable);
        span.setAttribute(
          "planning_catalog_available",
          !planningResult.unavailable,
        );
        span.setAttribute("aggregate_issue_count", aggregates.filteredTotal);
        return response;
      } catch (err) {
        throw new SchemaValidationError({
          issues: [
            err instanceof Error
              ? err.message
              : "Report response validation failed",
          ],
        });
      }
    },
  );
}
