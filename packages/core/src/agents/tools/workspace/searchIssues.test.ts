import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../../../errors";
import { SearchIssuesOutputSchema } from "../../../schemas/ai/tools";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { callTool } from "../__test-helpers__/callTool";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../__test-helpers__/otelMock";
import { createSearchIssuesTool } from "./searchIssues";

mockOpenTelemetry();

const makeAdapter = makeTestAkbAdapter;

function makeIssue(overrides: Partial<IssueMetadata>): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Fix the login flow",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
    ...overrides,
  };
}

/** Empty-query fallback is a single SELECT against reef_issues. */
function issuesResponse(issues: IssueMetadata[]) {
  return [{ body: makeIssueQueryResponse(issues) }];
}

function searchHit(issue: IssueMetadata, score = 0.91) {
  return {
    uri: `akb://reef-acme/doc/issues/${issue.id.toLowerCase()}.md`,
    title: issue.id,
    summary: issue.title,
    score,
    matched_section: `Matched ${issue.title}`,
    source_type: "document",
    vault: "reef-acme",
    collection: "issues",
    type: "task",
    tags: issue.labels ?? [],
  };
}

const ISSUES: IssueMetadata[] = [
  makeIssue({
    id: "REEF-001",
    title: "Fix the login flow",
    status: "todo",
    priority: "high",
    assigned_to: "alice",
    labels: ["bug", "frontend"],
  }),
  makeIssue({
    id: "REEF-002",
    title: "Polish settings page",
    status: "in_progress",
    priority: "medium",
    assigned_to: "bob",
    labels: ["polish"],
  }),
  makeIssue({
    id: "REEF-003",
    title: "Database migration plan",
    status: "done",
    priority: "low",
    assigned_to: "alice",
    labels: ["bug", "backend"],
  }),
];

describe("createSearchIssuesTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns metadata-only hybrid results for non-empty query", async () => {
    setupFetch([
      { body: { results: [searchHit(ISSUES[0])] } },
      { body: makeIssueQueryResponse([ISSUES[0]]) },
    ]);
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "login",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });

    expect(result.issues.map((i) => i.id)).toEqual(["REEF-001"]);
    expect(result.issues[0]?.matched_section).toContain("Fix the login flow");
    expect(result.issues[0]?.score).toBe(0.91);
    // No body field on search results — metadata just.
    // biome-ignore lint/suspicious/noExplicitAny: probing absence
    expect((result.issues[0] as any).body).toBeUndefined();
  });

  it("does not exclude done issues when status is null", async () => {
    setupFetch([
      { body: { results: [searchHit(ISSUES[2])] } },
      { body: makeIssueQueryResponse([ISSUES[2]]) },
    ]);
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "database migration",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });

    expect(result.issues.map((i) => [i.id, i.status])).toEqual([
      ["REEF-003", "done"],
    ]);
  });

  it("does not expose semantic actor or provenance metadata to the model", async () => {
    setupFetch(
      issuesResponse([
        makeIssue({
          id: "REEF-010",
          title: "Private provenance",
          created_by: "alice@example.com",
          updated_by: "bob@example.com",
          source: "ai-agent:create_issue:reef-draft-0123456789abcdef",
        }),
      ]),
    );
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });

    expect(result.issues[0]).not.toHaveProperty("created_by");
    expect(result.issues[0]).not.toHaveProperty("updated_by");
    expect(result.issues[0]).not.toHaveProperty("source");
  });

  it("filters by status (subset match)", async () => {
    setupFetch(issuesResponse(ISSUES));
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "",
      status: ["todo", "in_progress"],
      assigned_to: null,
      labels: null,
      limit: 20,
    });

    expect(result.issues.map((i) => i.id).sort()).toEqual([
      "REEF-001",
      "REEF-002",
    ]);
  });

  it("filters by assigned_to (exact match)", async () => {
    setupFetch(issuesResponse(ISSUES));
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "",
      status: null,
      assigned_to: "alice",
      labels: null,
      limit: 20,
    });

    expect(result.issues.map((i) => i.id).sort()).toEqual([
      "REEF-001",
      "REEF-003",
    ]);
  });

  it("filters by labels (AND across required labels)", async () => {
    setupFetch(issuesResponse(ISSUES));
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: ["bug", "backend"],
      limit: 20,
    });

    expect(result.issues.map((i) => i.id)).toEqual(["REEF-003"]);
  });

  it("clamps results to `limit`", async () => {
    setupFetch(issuesResponse(ISSUES));
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 2,
    });

    expect(result.issues).toHaveLength(2);
  });

  it("memoises empty-query listIssues across calls within the same tool instance", async () => {
    const { calls } = setupFetch(issuesResponse(ISSUES));
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });
    await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });
    await callTool(tool, {
      query: "",
      status: ["done"],
      assigned_to: null,
      labels: null,
      limit: 20,
    });

    // A single SELECT — subsequent empty-query calls reuse the cached promise.
    expect(calls).toHaveLength(1);
  });

  it("re-fetches on the next call when the first listIssues round throws", async () => {
    // First listIssues SELECT returns 401; the cache is reset by the catch
    // block so the next call re-attempts.
    setupFetch([
      { status: 401, body: { detail: "invalid token" } },
      { body: makeIssueQueryResponse(ISSUES) },
    ]);
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    await expect(
      callTool(tool, {
        query: "",
        status: null,
        assigned_to: null,
        labels: null,
        limit: 20,
      }),
    ).rejects.toBeInstanceOf(AuthError);

    const result = await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });
    expect(result.issues).toHaveLength(ISSUES.length);
  });

  it("output validates against SearchIssuesOutputSchema", async () => {
    setupFetch(issuesResponse(ISSUES));
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    const result = await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });

    expect(SearchIssuesOutputSchema.safeParse(result).success).toBe(true);
  });

  it("queries the reef_issues table via the SQL endpoint", async () => {
    const { calls } = setupFetch(issuesResponse(ISSUES));
    const tool = createSearchIssuesTool({
      adapter: makeAdapter(),
      vault: "reef-acme",
    });

    await callTool(tool, {
      query: "",
      status: null,
      assigned_to: null,
      labels: null,
      limit: 20,
    });

    const sqlUrl = new URL(calls[0].url);
    expect(sqlUrl.pathname).toBe("/api/v1/tables/reef-acme/sql");
    const sql = JSON.parse(calls[0].init?.body as string).sql as string;
    expect(sql).toContain("SELECT * FROM reef_issues");
  });
});
