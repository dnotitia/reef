import { describe, expect, it } from "vitest";
import { ReportResponseSchema } from "../../schemas/reports";
import { getReports } from "./reports";
import {
  ISSUE_ROW_COLUMNS,
  SAMPLE_ISSUE,
  makeAdapter,
  makeIssueRow,
  makeSqlQueryResponse,
  setupFetch,
  sqlRequestBody,
} from "./core/akb.testSupport";

const REPORT_ACTIVITY_COLUMNS = [
  "id",
  "reef_id",
  "event_type",
  "event_key",
  "payload",
  "meta",
  "created_at",
  "updated_at",
  "created_by",
];
const REPORT_ISSUE_ROW_COLUMNS = [...ISSUE_ROW_COLUMNS, "report_issue_count"];

describe("getReports", () => {
  it("loads AKB report inputs and returns only schema-validated aggregates", async () => {
    const issue = {
      ...SAMPLE_ISSUE,
      id: "REEF-617",
      status: "done" as const,
      created_at: "2026-05-20T00:00:00.000Z",
      updated_at: "2026-05-24T00:00:00.000Z",
      last_status_change: "2026-05-24T00:00:00.000Z",
      closed_at: "2026-05-25T00:00:00.000Z",
    };
    const activity = [
      {
        id: "event-1",
        reef_id: issue.id,
        event_type: "status_change",
        event_key: "status_change:todo->in_progress@2026-05-24T00:00:00.000Z",
        payload: { from: "todo", to: "in_progress" },
        meta: {
          actor: "alice",
          at: "2026-05-24T00:00:00.000Z",
          source: "web",
        },
        created_at: "2026-05-24T00:00:00.000Z",
        updated_at: "2026-05-24T00:00:00.000Z",
        created_by: "akb-principal",
      },
      {
        id: "event-2",
        reef_id: issue.id,
        event_type: "status_change",
        event_key: "status_change:in_progress->done@2026-05-25T00:00:00.000Z",
        payload: { from: "in_progress", to: "done" },
        meta: {
          actor: "alice",
          at: "2026-05-25T00:00:00.000Z",
          source: "web",
        },
        created_at: "2026-05-25T00:00:00.000Z",
        updated_at: "2026-05-25T00:00:00.000Z",
        created_by: "akb-principal",
      },
    ];
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [{ ...makeIssueRow(issue), report_issue_count: "1" }],
          REPORT_ISSUE_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(activity, REPORT_ACTIVITY_COLUMNS),
      },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
    ]);

    const report = await getReports({
      adapter: makeAdapter(),
      vault: "reef-sample",
      request: {
        filters: {
          period: "12w",
          scope: "all",
          measure: "count",
        },
        asOf: Date.parse("2026-05-26T00:00:00.000Z"),
        rollupDimension: "milestone",
        pivotRow: "assignee",
        pivotCol: "status",
      },
    });

    expect(ReportResponseSchema.safeParse(report).success).toBe(true);
    expect(report.issueCount).toBe(1);
    expect(report.aggregates.filteredTotal).toBe(1);
    expect(report.aggregates.byStatus).toContainEqual({
      status: "done",
      count: 1,
      points: 0,
    });
    expect(report.flowMetrics.cycle.completionWindowCount).toBeGreaterThan(0);
    expect(report).not.toHaveProperty("issues");
    expect(report).not.toHaveProperty("activity");
    expect(calls).toHaveLength(5);
    expect(sqlRequestBody(calls[0]).sql).toContain("COUNT(*) OVER ()");
    expect(sqlRequestBody(calls[0]).sql).toContain("archived_at IS NULL");
    expect(sqlRequestBody(calls[1]).sql).toContain(
      "reef_id IN (SELECT reef_id FROM reef_issues)",
    );
  });
});
