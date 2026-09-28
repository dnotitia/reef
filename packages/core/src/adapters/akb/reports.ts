import { SchemaValidationError } from "../../errors";
import {
  computeAggregates,
  computeFlowMetrics,
  computeForecast,
  computeHealthRollup,
  computePivot,
  DEFAULT_FORECAST_HORIZON_WEEKS,
  distinctParentIds,
} from "../../models/reports";
import { ACTIVE_STATUSES } from "../../models/status";
import {
  ReportRequestSchema,
  type ReportRequest,
  type ReportResponse,
  ReportResponseSchema,
} from "../../schemas/reports";
import type { IssueListItem } from "../../schemas/issues/metadata";
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
): Promise<{ issues: IssueListItem[]; issueCount: number }> {
  return withSpan("akb.list_report_issues", { vault }, async (span) => {
    let rows: Record<string, unknown>[];
    try {
      // Keep the simple population count in AKB SQL alongside the row read;
      // all multidimensional calculations consume the validated core models.
      const result = await runSql(
        adapter,
        vault,
        `SELECT *, COUNT(*) OVER () AS report_issue_count FROM ${tableRef(
          REEF_ISSUES_TABLE,
        )}`,
      );
      rows = result.kind === "table_query" ? result.items : [];
    } catch (err) {
      if (isMissingTableError(err)) {
        span.setAttribute("table_exists", false);
        return { issues: [], issueCount: 0 };
      }
      throw err;
    }

    const rawCount = rows[0]?.report_issue_count ?? rows.length;
    const sqlIssueCount = Number(rawCount);
    if (!Number.isSafeInteger(sqlIssueCount) || sqlIssueCount < 0) {
      throw new SchemaValidationError({
        issues: ["report issue count from AKB SQL is invalid"],
      });
    }
    const issues: IssueListItem[] = [];
    for (const row of rows) {
      try {
        issues.push(rowToIssue(row));
      } catch {
        // Match the issue-list adapter: malformed projections are skipped alone.
      }
    }
    span.setAttribute("row_count", rows.length);
    span.setAttribute("issue_count", issues.length);
    span.setAttribute("sql_issue_count", sqlIssueCount);
    return { issues, issueCount: issues.length };
  });
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
      const [issueResult, activity, catalog] = await Promise.all([
        listReportIssues(adapter, vault),
        listReportStatusActivity(adapter, vault),
        listPlanningCatalog({ adapter, vault }),
      ]);
      const { issues, issueCount } = issueResult;

      const now = request.asOf;
      const aggregates = computeAggregates(issues, {
        filters: request.filters,
        now,
      });
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
      const availableDimensions = [
        ...(catalog.milestones.length > 0 ? (["milestone"] as const) : []),
        ...(catalog.sprints.length > 0 ? (["sprint"] as const) : []),
        ...(catalog.releases.length > 0 ? (["release"] as const) : []),
        ...(distinctParentIds(issues).length > 0 ? (["parent"] as const) : []),
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
        forecast,
        healthRollup,
        pivot,
      };
      try {
        const response = ReportResponseSchema.parse(result);
        span.setAttribute("issue_count", issues.length);
        span.setAttribute("activity_count", activity.length);
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
