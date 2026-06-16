import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeIssueQueryResponse,
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { mockOpenTelemetry } from "../../../agents/tools/__test-helpers__/otelMock";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { IssueListQuerySchema } from "../../../schemas/issues/requests";
import {
  buildDefaultViewWhere,
  defaultViewStatusFloor,
  encodeCursor,
} from "../core/shared";
import { getActiveSprint } from "../planning/planning";
import { listIssues } from "./issues";

mockOpenTelemetry();

const FLOOR = `"archived_at" IS NULL AND "status" IN ('todo', 'in_progress', 'in_review')`;
const SPRINT_ID = "11111111-1111-4111-8111-111111111111";

const ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Fix login",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
  assigned_to: "alice",
};

function sprintRow(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SPRINT_ID,
    name: "Sprint 1",
    status: "active",
    start_date: "2026-05-01",
    end_date: "2026-05-14",
    goal: "",
    ...over,
  };
}

function tableQuery(rows: Record<string, unknown>[]): unknown {
  return {
    kind: "table_query",
    columns: rows.length ? Object.keys(rows[0]) : [],
    items: rows,
    total: rows.length,
  };
}

function sqlOf(call: { init: RequestInit | undefined }): string {
  return JSON.parse(String(call.init?.body)).sql as string;
}

describe("buildDefaultViewWhere", () => {
  it("floors to active, non-archived issues with no actor or sprint", () => {
    expect(defaultViewStatusFloor()).toBe(FLOOR);
    expect(buildDefaultViewWhere({ actor: null, sprintId: null })).toBe(FLOOR);
  });

  it("narrows to My Issues when an actor is present", () => {
    expect(buildDefaultViewWhere({ actor: "alice", sprintId: SPRINT_ID })).toBe(
      `${FLOOR} AND "assigned_to" = 'alice'`,
    );
  });

  it("narrows to the active sprint when there is no actor", () => {
    expect(buildDefaultViewWhere({ actor: null, sprintId: SPRINT_ID })).toBe(
      `${FLOOR} AND "sprint_id" = '${SPRINT_ID}'`,
    );
  });

  it("escapes the actor value (injection-safe)", () => {
    expect(buildDefaultViewWhere({ actor: "a'b", sprintId: null })).toBe(
      `${FLOOR} AND "assigned_to" = 'a''b'`,
    );
  });
});

describe("getActiveSprint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the active sprint, picking the most recently started", async () => {
    setupFetch([
      {
        body: tableQuery([
          sprintRow({
            id: "00000000-0000-4000-8000-000000000000",
            start_date: "2026-01-01",
            end_date: "2026-01-14",
          }),
          sprintRow({ id: SPRINT_ID, start_date: "2026-05-01" }),
        ]),
      },
    ]);
    const sprint = await getActiveSprint(makeTestAkbAdapter(), "reef-acme");
    expect(sprint?.id).toBe(SPRINT_ID);
  });

  it("returns null for a never-onboarded vault (missing table)", async () => {
    setupFetch([
      {
        body: { error: 'relation "vt_reef-acme__reef_sprints" does not exist' },
      },
    ]);
    const sprint = await getActiveSprint(makeTestAkbAdapter(), "reef-acme");
    expect(sprint).toBeNull();
  });

  it("returns null when there are no active sprints", async () => {
    setupFetch([{ body: tableQuery([]) }]);
    const sprint = await getActiveSprint(makeTestAkbAdapter(), "reef-acme");
    expect(sprint).toBeNull();
  });
});

describe("listIssues default_view", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies the My-Issues predicate when the actor has active issues", async () => {
    const { calls } = setupFetch([
      { body: tableQuery([sprintRow()]) }, // getActiveSprint
      { body: makeIssueQueryResponse([ISSUE]) }, // My-Issues existence check
      { body: makeIssueQueryResponse([ISSUE]) }, // main fetch
    ]);
    const query = IssueListQuerySchema.parse({ default_view: true });
    const res = await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    expect(res.issues).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(sqlOf(calls[1])).toContain("LIMIT 1");
    expect(sqlOf(calls[2])).toContain(`"assigned_to" = 'alice'`);
  });

  it("falls back to the sprint/floor view when My Issues is empty", async () => {
    const { calls } = setupFetch([
      { body: tableQuery([sprintRow()]) },
      { body: makeIssueQueryResponse([]) },
      { body: makeIssueQueryResponse([]) },
    ]);
    const query = IssueListQuerySchema.parse({ default_view: true });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    expect(calls).toHaveLength(3);
    expect(sqlOf(calls[1])).toContain(`"assigned_to" = 'alice'`);
    expect(sqlOf(calls[2])).toContain(`"sprint_id" = '${SPRINT_ID}'`);
    expect(sqlOf(calls[2])).not.toContain("assigned_to");
  });

  it("uses the active sprint when no actor is resolved", async () => {
    const { calls } = setupFetch([
      { body: tableQuery([sprintRow()]) },
      { body: makeIssueQueryResponse([]) },
    ]);
    const query = IssueListQuerySchema.parse({ default_view: true });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
    });
    expect(calls).toHaveLength(2);
    expect(sqlOf(calls[1])).toContain(`"sprint_id" = '${SPRINT_ID}'`);
  });

  it("keeps the resolved scope consistent on cursor pages when My Issues is empty", async () => {
    const cursor = encodeCursor(
      { created_at: "2026-05-02T00:00:00.000Z", reef_id: "REEF-050" },
      "created_at",
    );
    const { calls } = setupFetch([
      { body: tableQuery([sprintRow()]) }, // getActiveSprint
      { body: makeIssueQueryResponse([]) }, // My-Issues existence check (empty)
      { body: makeIssueQueryResponse([]) }, // main page-2 fetch
    ]);
    const query = IssueListQuerySchema.parse({
      default_view: true,
      limit: 50,
      sort_field: "created_at",
      cursor,
    });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    // Page 2 should query the fallback (sprint) scope + keyset, not empty My Issues.
    expect(sqlOf(calls[2])).toContain(`"sprint_id" = '${SPRINT_ID}'`);
    expect(sqlOf(calls[2])).not.toContain("assigned_to");
    expect(sqlOf(calls[2])).toContain(
      `"created_at" < '2026-05-02T00:00:00.000Z'`,
    );
  });

  it("lets explicit filters override default_view", async () => {
    const { calls } = setupFetch([{ body: makeIssueQueryResponse([]) }]);
    const query = IssueListQuerySchema.parse({
      default_view: true,
      status: ["done"],
    });
    await listIssues({
      adapter: makeTestAkbAdapter(),
      vault: "reef-acme",
      query,
      actor: "alice",
    });
    // No getActiveSprint call (default-view branch skipped) and the WHERE is the
    // explicit facet, not the My-Issues / sprint default view.
    expect(calls).toHaveLength(1);
    expect(sqlOf(calls[0])).toContain(`"status" IN ('done')`);
    expect(sqlOf(calls[0])).not.toContain("assigned_to");
  });
});
