import { describe, expect, it } from "vitest";
import { AuthError } from "../../errors";
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
    const archivedIssue = {
      ...SAMPLE_ISSUE,
      id: "REEF-618",
      archived_at: "2026-05-24T00:00:00.000Z",
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
          [makeIssueRow(issue), makeIssueRow(archivedIssue)],
          ISSUE_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(activity, REPORT_ACTIVITY_COLUMNS),
      },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      {
        body: makeSqlQueryResponse(
          [
            { status: "todo", count: 1, points: 0 },
            { status: "done", count: 1, points: 0 },
          ],
          ["status", "count", "points"],
        ),
      },
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
    expect(report.issueCount).toBe(2);
    expect(report.aggregates.filteredTotal).toBe(2);
    expect(report.aggregates.byStatus).toContainEqual({
      status: "done",
      count: 1,
      points: 0,
    });
    expect(report.aggregates.byStatus).toContainEqual({
      status: "todo",
      count: 1,
      points: 0,
    });
    expect(report.flowMetricsUnavailable).toBe(false);
    expect(report.flowMetrics.cycle.completionWindowCount).toBeGreaterThan(0);
    expect(report).not.toHaveProperty("issues");
    expect(report).not.toHaveProperty("activity");
    expect(calls).toHaveLength(6);
    expect(sqlRequestBody(calls[0]).sql).not.toContain("COUNT(*) OVER ()");
    expect(sqlRequestBody(calls[0]).sql).not.toContain("archived_at IS NULL");
    expect(sqlRequestBody(calls[1]).sql).toContain(
      "reef_id IN (SELECT reef_id FROM reef_issues)",
    );
    expect(
      calls.some(({ init }) =>
        sqlRequestBody({ url: "", init }).sql.includes('GROUP BY "status"'),
      ),
    ).toBe(true);
  });

  it("uses SQL status totals for the report aggregate over validated filtered issues", async () => {
    const included = {
      ...SAMPLE_ISSUE,
      id: "REEF-617",
      status: "todo" as const,
      estimate_points: 3,
    };
    const archived = {
      ...SAMPLE_ISSUE,
      id: "REEF-618",
      status: "done" as const,
      archived_at: "2026-05-24T00:00:00.000Z",
    };
    const nonmatching = {
      ...SAMPLE_ISSUE,
      id: "REEF-620",
      assigned_to: "bob",
    };
    const malformed = makeIssueRow({
      ...SAMPLE_ISSUE,
      id: "REEF-619",
    });
    malformed.status = "invalid";
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            makeIssueRow(included),
            makeIssueRow(archived),
            makeIssueRow(nonmatching),
            malformed,
          ],
          ISSUE_ROW_COLUMNS,
        ),
      },
      { body: makeSqlQueryResponse([], REPORT_ACTIVITY_COLUMNS) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      {
        body: makeSqlQueryResponse(
          [{ status: "in_progress", count: 7, points: 21 }],
          ["status", "count", "points"],
        ),
      },
    ]);

    const report = await getReports({
      adapter: makeAdapter(),
      vault: "reef-sample",
      request: {
        filters: {
          period: "12w",
          scope: "active",
          measure: "count",
          assignee: "alice",
        },
        asOf: Date.parse("2026-05-26T00:00:00.000Z"),
        rollupDimension: "milestone",
        pivotRow: "assignee",
        pivotCol: "status",
      },
    });

    expect(report.issueCount).toBe(3);
    expect(report.aggregates.filteredTotal).toBe(7);
    expect(report.aggregates.total).toBe(7);
    expect(report.aggregates.byStatus).toContainEqual({
      status: "in_progress",
      count: 7,
      points: 21,
    });
    const aggregateCall = calls.find(({ init }) =>
      sqlRequestBody({ url: "", init }).sql.includes("GROUP BY"),
    );
    expect(aggregateCall).toBeDefined();
    const aggregateRequest = sqlRequestBody(aggregateCall);
    expect(aggregateRequest.sql).toContain("COUNT(*)");
    expect(aggregateRequest.sql).toContain('SUM("estimate_points")');
    expect(aggregateRequest.sql).toContain("jsonb_array_elements_text");
    expect(aggregateRequest.params).toEqual([JSON.stringify(["REEF-617"])]);
  });

  it("keeps report aggregates available when activity and planning reads fail", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [makeIssueRow(SAMPLE_ISSUE)],
          ISSUE_ROW_COLUMNS,
        ),
      },
      { status: 500, body: { detail: "activity unavailable" } },
      { status: 500, body: { detail: "planning unavailable" } },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      {
        body: makeSqlQueryResponse(
          [{ status: "todo", count: 1, points: 0 }],
          ["status", "count", "points"],
        ),
      },
    ]);

    const report = await getReports({
      adapter: makeAdapter(),
      vault: "reef-sample",
      request: {
        filters: { period: "12w", scope: "active", measure: "count" },
        asOf: Date.parse("2026-05-26T00:00:00.000Z"),
        rollupDimension: "milestone",
        pivotRow: "assignee",
        pivotCol: "status",
      },
    });

    expect(report.aggregates.filteredTotal).toBe(1);
    expect(report.flowMetricsUnavailable).toBe(true);
    expect(report.availableDimensions).toEqual([]);
    expect(report.healthRollup).toEqual([]);
  });

  it("does not suppress an AKB authorization error from an auxiliary read", async () => {
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [makeIssueRow(SAMPLE_ISSUE)],
          ISSUE_ROW_COLUMNS,
        ),
      },
      { status: 401, body: { detail: "session expired" } },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      { body: makeSqlQueryResponse([], ["id", "name", "status"]) },
      {
        body: makeSqlQueryResponse(
          [{ status: "todo", count: 1, points: 0 }],
          ["status", "count", "points"],
        ),
      },
    ]);

    await expect(
      getReports({
        adapter: makeAdapter(),
        vault: "reef-sample",
        request: {
          filters: { period: "12w", scope: "active", measure: "count" },
          asOf: Date.parse("2026-05-26T00:00:00.000Z"),
          rollupDimension: "milestone",
          pivotRow: "assignee",
          pivotCol: "status",
        },
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
