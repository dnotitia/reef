import { afterEach, describe, expect, it, vi } from "vitest";
import { createAkbAdapter } from "../core/shared";
import { getWorkspaceSummary } from "./workspaceSummary";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function tableQuery(items: Record<string, unknown>[]): unknown {
  return {
    kind: "table_query",
    columns: items[0] ? Object.keys(items[0]) : [],
    items,
    total: items.length,
  };
}

/**
 * Route every akb SQL POST by the table it names, so the two grounding reads
 * (planning catalog + issue count) resolve independently of Promise.all order.
 */
function installSqlRouter(
  routes: { match: string; response: unknown; status?: number }[],
): void {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const sql = init?.body
      ? ((JSON.parse(init.body as string) as { sql?: string }).sql ?? "")
      : "";
    const route = routes.find((r) => sql.includes(r.match));
    if (!route) throw new Error(`No SQL route for: ${sql}`);
    return jsonResponse(route.response, route.status ?? 200);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function makeAdapter() {
  return createAkbAdapter({ baseUrl: "https://akb.test", jwt: "jwt.example" });
}

const ACTIVE_SPRINT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Sprint 6",
  status: "active",
  goal: "Ship chat grounding",
};

describe("getWorkspaceSummary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns the active sprint, open count (excluding done/closed), and by-status breakdown", async () => {
    installSqlRouter([
      { match: "reef_sprints", response: tableQuery([ACTIVE_SPRINT]) },
      { match: "reef_milestones", response: tableQuery([]) },
      { match: "reef_releases", response: tableQuery([]) },
      {
        match: "reef_issues",
        response: tableQuery([
          { status: "todo", count: 5 },
          { status: "in_progress", count: 4 },
          { status: "in_review", count: 2 },
          { status: "done", count: 8 },
          { status: "closed", count: 3 },
        ]),
      },
    ]);

    const summary = await getWorkspaceSummary({
      adapter: makeAdapter(),
      vault: "reef-e2e",
    });

    expect(summary.vault).toBe("reef-e2e");
    expect(summary.activeSprint).toEqual({
      name: "Sprint 6",
      goal: "Ship chat grounding",
    });
    // 5 + 4 + 2 open; done (8) and closed (3) excluded.
    expect(summary.openIssueCount).toBe(11);
    expect(summary.statusCounts).toHaveLength(5);
  });

  it("reports no active sprint when none is active", async () => {
    installSqlRouter([
      {
        match: "reef_sprints",
        response: tableQuery([
          { ...ACTIVE_SPRINT, status: "planned", goal: "" },
        ]),
      },
      { match: "reef_milestones", response: tableQuery([]) },
      { match: "reef_releases", response: tableQuery([]) },
      {
        match: "reef_issues",
        response: tableQuery([{ status: "todo", count: 1 }]),
      },
    ]);

    const summary = await getWorkspaceSummary({
      adapter: makeAdapter(),
      vault: "reef-e2e",
    });

    expect(summary.activeSprint).toBeNull();
    expect(summary.openIssueCount).toBe(1);
  });

  it("degrades open counts to [] when the reef_issues table is missing", async () => {
    installSqlRouter([
      { match: "reef_sprints", response: tableQuery([ACTIVE_SPRINT]) },
      { match: "reef_milestones", response: tableQuery([]) },
      { match: "reef_releases", response: tableQuery([]) },
      // akb surfaces a missing relation as an HTTP 200 { error } envelope.
      {
        match: "reef_issues",
        response: { error: 'relation "reef_issues" does not exist' },
      },
    ]);

    const summary = await getWorkspaceSummary({
      adapter: makeAdapter(),
      vault: "reef-e2e",
    });

    expect(summary.statusCounts).toEqual([]);
    expect(summary.openIssueCount).toBe(0);
    // The active sprint still resolves independently.
    expect(summary.activeSprint?.name).toBe("Sprint 6");
  });
});
