import { afterEach, describe, expect, it, vi } from "vitest";
import { AkbApiError, SchemaValidationError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
import { listMyWorkIssues } from "./listMyWorkIssues";

mockOpenTelemetry();

const BASE_ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Assigned work",
  status: "todo",
  issue_type: "task",
  assigned_to: "alice",
  created_at: "2026-06-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-06-02T00:00:00.000Z",
  updated_by: "alice",
};

function responseWithWorkspace(
  issues: Array<{ workspace: string; issue: IssueMetadata }>,
) {
  const response = makeIssueQueryResponse(issues.map(({ issue }) => issue)) as {
    columns: string[];
    items: Array<Record<string, unknown>>;
    total: number;
    kind: "table_query";
  };
  return {
    ...response,
    columns: [...response.columns, "workspace"],
    items: response.items.map((row, index) => ({
      ...row,
      workspace: issues[index]?.workspace,
    })),
  };
}

function bodyAt(
  calls: Array<{ init: RequestInit | undefined }>,
  index: number,
) {
  return JSON.parse(String(calls[index]?.init?.body)) as {
    sql: string;
    params: unknown[];
    vaults: string[];
  };
}

describe("listMyWorkIssues", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries ready workspaces together, returns open rows, and paginates globally", async () => {
    const rows = responseWithWorkspace([
      {
        workspace: "reef-e2e",
        issue: { ...BASE_ISSUE, title: "Other copy of the same ID" },
      },
      {
        workspace: "reef-e2e",
        issue: { ...BASE_ISSUE, id: "REEF-002", title: "E2E next" },
      },
      { workspace: "reef-zeta", issue: { ...BASE_ISSUE } },
      {
        workspace: "reef-zeta",
        issue: { ...BASE_ISSUE, id: "REEF-002", title: "Zeta next" },
      },
    ]);
    const { calls } = setupFetch([
      { body: rows },
      {
        body: {
          kind: "table_query",
          columns: [
            "workspace",
            "sprint_id",
            "assigned_count",
            "resolved_count",
          ],
          items: [
            {
              workspace: "reef-alpha",
              sprint_id: "sprint-1",
              assigned_count: "5",
              resolved_count: "2",
            },
          ],
          total: 1,
        },
      },
    ]);

    const result = await listMyWorkIssues({
      adapter: makeTestAkbAdapter(),
      actor: " alice ",
      vaults: ["reef-zeta", "reef-e2e", "reef-alpha"],
      query: { limit: 2, offset: 2 },
    });

    expect(
      result.issues.map(({ workspace, issue }) => [workspace, issue.id]),
    ).toEqual([
      ["reef-e2e", "REEF-001"],
      ["reef-e2e", "REEF-002"],
    ]);
    expect(result.next_offset).toBe(4);
    expect(result.workspaces).toEqual([
      {
        workspace: "reef-alpha",
        assigned_issue_count: 5,
        resolved_sprint_counts: [{ sprint_id: "sprint-1", count: 2 }],
      },
      {
        workspace: "reef-e2e",
        assigned_issue_count: 0,
        resolved_sprint_counts: [],
      },
      {
        workspace: "reef-zeta",
        assigned_issue_count: 0,
        resolved_sprint_counts: [],
      },
    ]);
    expect(Date.parse(result.as_of)).not.toBeNaN();

    const issueRequest = bodyAt(calls, 0);
    expect(issueRequest.vaults).toEqual([
      "reef-alpha",
      "reef-e2e",
      "reef-zeta",
    ]);
    expect(issueRequest.sql).toContain("reef_alpha__reef_issues");
    expect(issueRequest.sql).toContain("reef_e2e__reef_issues");
    expect(issueRequest.sql).toContain("reef_zeta__reef_issues");
    expect(issueRequest.sql).toContain('"archived_at" IS NULL');
    expect(issueRequest.sql).toContain('"workspace" ASC, "reef_id" ASC');
    expect(issueRequest.sql).toContain("LIMIT $10 OFFSET $11");
    expect(issueRequest.params).toEqual([
      "alice",
      expect.any(String),
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "reef-alpha",
      "reef-e2e",
      "reef-zeta",
      3,
      2,
    ]);
    expect(bodyAt(calls, 1).vaults).toEqual(issueRequest.vaults);
    expect(bodyAt(calls, 1).sql).toContain("\"status\" IN ('done', 'closed')");
  });

  it("does not make an AKB request when no ready workspace is available", async () => {
    const { calls } = setupFetch([]);
    const result = await listMyWorkIssues({
      adapter: makeTestAkbAdapter(),
      actor: "alice",
      vaults: [],
    });

    expect(result.issues).toEqual([]);
    expect(result.workspaces).toEqual([]);
    expect(result.next_offset).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("rejects unsafe or alias-colliding vault inputs", async () => {
    const { calls } = setupFetch([]);
    const adapter = makeTestAkbAdapter();

    await expect(
      listMyWorkIssues({
        adapter,
        actor: "alice",
        vaults: ["reef-e2e", "reef-e2e"],
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      listMyWorkIssues({
        adapter,
        actor: "alice",
        vaults: ["reef-e2e", "reef_e2e"],
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      listMyWorkIssues({ adapter, actor: "alice", vaults: ["reef/other"] }),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    expect(calls).toHaveLength(0);
  });

  it("propagates AKB access failures from the cross-vault query", async () => {
    setupFetch([{ status: 403, body: { error: "permission denied" } }]);

    await expect(
      listMyWorkIssues({
        adapter: makeTestAkbAdapter(),
        actor: "alice",
        vaults: ["reef-e2e"],
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
  });
});
