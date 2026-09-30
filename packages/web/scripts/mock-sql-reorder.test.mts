// @vitest-environment node
import {
  akbListIssueActivity,
  akbListIssues,
  akbReorderIssue as reorderIssue,
  computeAggregates,
  createAkbAdapter,
  DEFAULT_REPORT_FILTERS,
  isStaleResolved,
} from "@reef/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTimeline } from "../src/features/issues/components/activity/timelineModel";
import { filterIssues } from "../src/features/issues/lib/issueListUtils";
import { REEF_VAULT } from "../tests/e2e/harness/mock-fixtures.mjs";
import { handleSql, resolveSqlParams } from "../tests/e2e/harness/mock-sql.mjs";
import { createState } from "../tests/e2e/harness/mock-state.mjs";

const ACTOR = "fixture-editor";
const BEFORE_AT = "2026-06-01T00:00:00.000Z";
const MOVED_AT = "2026-09-29T12:00:00.000Z";

type TimestampSeed = string | null | "missing";

interface IssueSeed {
  reef_id: string;
  status: string;
  priority?: string;
  rank: number | null;
  last_status_change: TimestampSeed;
  closed_at?: string | null;
  closed_reason?: string | null;
}

interface ActivitySeed {
  id: string;
  reef_id: string;
  from: string;
  to: string;
  at: string;
}

interface FixtureIssueRow {
  reef_id: string;
  title: string;
  status: string;
  priority?: string;
  rank: number | null;
  archived_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  meta: Record<string, unknown>;
}

interface FixtureActivityRow {
  id: string;
  reef_id: string;
  event_type: string;
  event_key: string;
  payload: Record<string, unknown>;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  created_by: string;
}

interface FixtureVault {
  issues: FixtureIssueRow[];
  activity: FixtureActivityRow[];
  tables: Set<string>;
}

interface FixtureState {
  vaults: Map<string, FixtureVault>;
}

function statusActivity(seed: ActivitySeed) {
  return {
    id: seed.id,
    reef_id: seed.reef_id,
    event_type: "status_change",
    event_key: `status_change:${seed.from}->${seed.to}@${seed.at}`,
    payload: { from: seed.from, to: seed.to },
    meta: { actor: "alice", at: seed.at, source: null },
    created_at: seed.at,
    updated_at: seed.at,
    created_by: "alice",
  };
}

function setupFixture(issues: IssueSeed[], activities: ActivitySeed[] = []) {
  const state = createState("configured") as unknown as FixtureState;
  const vault = state.vaults.get(REEF_VAULT);
  if (!vault || !vault.issues[0]) throw new Error("configured fixture missing");

  const template = structuredClone(vault.issues[0]);
  vault.issues = issues.map((seed) => {
    const meta: Record<string, unknown> = {
      author: "alice",
      last_editor: "seed-editor",
      source: "fixture:reorder-test",
      fixture_marker: `preserve:${seed.reef_id}`,
    };
    if (seed.last_status_change !== "missing") {
      meta.last_status_change = seed.last_status_change;
    }
    return {
      ...structuredClone(template),
      reef_id: seed.reef_id,
      title: `Issue ${seed.reef_id}`,
      status: seed.status,
      priority: seed.priority ?? template.priority,
      rank: seed.rank,
      archived_at: null,
      closed_at: seed.closed_at ?? null,
      closed_reason: seed.closed_reason ?? null,
      created_at: "2020-01-01T00:00:00.000Z",
      created_by: "alice",
      updated_at: BEFORE_AT,
      meta,
    };
  });
  vault.activity = activities.map(statusActivity);

  const sqlCalls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      if (path === `/api/v1/tables/${REEF_VAULT}`) {
        return new Response(
          JSON.stringify({
            kind: "table",
            vault: REEF_VAULT,
            items: [...vault.tables].map((name) => ({ name })),
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (path === `/api/v1/tables/${REEF_VAULT}/sql`) {
        const body = JSON.parse(String(init?.body)) as {
          sql: string;
          params?: unknown[];
        };
        const sql = resolveSqlParams(body.sql, body.params);
        sqlCalls.push(sql);
        const result = handleSql(state, vault, sql, "alice");
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fixture request: ${path}`);
    }),
  );

  return {
    state,
    vault,
    sqlCalls,
    adapter: createAkbAdapter({
      baseUrl: "https://akb.test",
      credential: "fixture-auth-value",
    }),
  };
}

describe("reorderIssue against the hermetic SQL harness (REEF-655)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps rank-only neighbors' status times during unranked-tail materialization", async () => {
    const { state, vault, sqlCalls, adapter } = setupFixture([
      {
        reef_id: "REEF-001",
        status: "closed",
        rank: null,
        last_status_change: "missing",
        closed_at: "2021-03-01T00:00:00.000Z",
        closed_reason: "completed",
      },
      {
        reef_id: "REEF-002",
        status: "todo",
        rank: null,
        last_status_change: null,
      },
      {
        reef_id: "REEF-003",
        status: "done",
        rank: null,
        last_status_change: "2020-01-01T00:00:00.000Z",
      },
      {
        reef_id: "REEF-004",
        status: "todo",
        rank: null,
        last_status_change: "2025-01-01T00:00:00.000Z",
      },
    ]);

    const result = await reorderIssue({
      adapter,
      vault: REEF_VAULT,
      scope: "active",
      issueId: "REEF-004",
      beforeId: "REEF-001",
      afterId: null,
      expected: {
        issueRank: null,
        issueUpdatedAt: BEFORE_AT,
        beforeRank: null,
        beforeUpdatedAt: BEFORE_AT,
        afterRank: null,
        afterUpdatedAt: null,
      },
      group: {
        field: "status",
        value: "closed",
        closed_reason: "completed",
      },
      actor: ACTOR,
      at: MOVED_AT,
    });

    expect(result.assignments).toHaveLength(4);
    expect(vault.issues.map((row) => row.rank).every(Number.isFinite)).toBe(
      true,
    );
    const row = (reefId: string) => {
      const issue = vault.issues.find(
        (candidate) => candidate.reef_id === reefId,
      );
      if (!issue) throw new Error(`missing fixture issue ${reefId}`);
      return issue;
    };
    expect(row("REEF-001").meta).not.toHaveProperty("last_status_change");
    expect(row("REEF-001")).toMatchObject({
      closed_at: "2021-03-01T00:00:00.000Z",
      closed_reason: "completed",
    });
    expect(row("REEF-002").meta).toMatchObject({ last_status_change: null });
    expect(row("REEF-003").meta).toMatchObject({
      last_status_change: "2020-01-01T00:00:00.000Z",
    });
    expect(row("REEF-004")).toMatchObject({
      status: "closed",
      closed_at: MOVED_AT,
      closed_reason: "completed",
    });
    expect(row("REEF-004").meta).toMatchObject({
      last_status_change: MOVED_AT,
    });
    await expect(
      akbListIssueActivity(adapter, REEF_VAULT, "REEF-004"),
    ).resolves.toMatchObject([
      {
        event_type: "status_change",
        payload: { from: "todo", to: "closed" },
        at: MOVED_AT,
        actor: ACTOR,
      },
    ]);
    for (const issue of vault.issues) {
      expect(issue.meta).toMatchObject({
        last_editor: ACTOR,
        source: "fixture:reorder-test",
        fixture_marker: `preserve:${issue.reef_id}`,
      });
    }

    const createdEvent = sqlCalls.find((sql) =>
      sql.toLowerCase().startsWith("insert into reef_activity "),
    );
    expect(createdEvent).toBeDefined();
    if (!createdEvent) return;
    const eventCount = vault.activity.filter(
      (event) =>
        event.reef_id === "REEF-004" && event.event_type === "status_change",
    ).length;
    handleSql(state, vault, createdEvent, "alice");
    expect(
      vault.activity.filter(
        (event) =>
          event.reef_id === "REEF-004" && event.event_type === "status_change",
      ),
    ).toHaveLength(eventCount);

    const moved = row("REEF-004");
    const firstNeighbor = vault.issues
      .filter((issue) => issue.reef_id !== moved.reef_id)
      .sort((left, right) => Number(left.rank) - Number(right.rank))[0];
    if (!firstNeighbor) throw new Error("missing rank neighbor");
    await reorderIssue({
      adapter,
      vault: REEF_VAULT,
      scope: "active",
      issueId: moved.reef_id,
      beforeId: null,
      afterId: firstNeighbor.reef_id,
      expected: {
        issueRank: moved.rank,
        issueUpdatedAt: moved.updated_at,
        beforeRank: null,
        beforeUpdatedAt: null,
        afterRank: firstNeighbor.rank,
        afterUpdatedAt: firstNeighbor.updated_at,
      },
      group: { field: "status", value: "in_progress" },
      actor: ACTOR,
      at: "2026-09-30T12:00:00.000Z",
    });
    expect(row("REEF-004")).toMatchObject({
      status: "in_progress",
      closed_at: null,
      closed_reason: null,
    });
    expect(row("REEF-004").meta).toMatchObject({
      last_status_change: "2026-09-30T12:00:00.000Z",
    });
    await expect(
      akbListIssueActivity(adapter, REEF_VAULT, "REEF-004"),
    ).resolves.toHaveLength(2);
  });

  it("keeps cross-status neighbors' times when exhausted ranks are re-spaced", async () => {
    const { vault, adapter } = setupFixture(
      [
        {
          reef_id: "REEF-001",
          status: "in_progress",
          rank: 1,
          last_status_change: "2026-06-01T00:00:00.000Z",
        },
        {
          reef_id: "REEF-002",
          status: "done",
          rank: 1 + Number.EPSILON,
          last_status_change: "2020-01-01T00:00:00.000Z",
        },
        {
          reef_id: "REEF-003",
          status: "todo",
          rank: 3000,
          last_status_change: "missing",
        },
        {
          reef_id: "REEF-004",
          status: "closed",
          rank: null,
          last_status_change: "2020-01-01T00:00:00.000Z",
          closed_at: "2020-01-01T00:00:00.000Z",
          closed_reason: "completed",
        },
      ],
      [
        {
          id: "seed-status-reef-001",
          reef_id: "REEF-001",
          from: "todo",
          to: "in_progress",
          at: "2026-06-01T00:00:00.000Z",
        },
      ],
    );

    const result = await reorderIssue({
      adapter,
      vault: REEF_VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: BEFORE_AT,
        beforeRank: 1,
        beforeUpdatedAt: BEFORE_AT,
        afterRank: 1 + Number.EPSILON,
        afterUpdatedAt: BEFORE_AT,
      },
      group: { field: "status", value: "in_progress" },
      actor: ACTOR,
      at: MOVED_AT,
    });

    expect(result.assignments).toHaveLength(3);
    const { issues } = await akbListIssues({ adapter, vault: REEF_VAULT });
    const issue = (reefId: string) => {
      const found = issues.find((candidate) => candidate.id === reefId);
      if (!found) throw new Error(`missing issue ${reefId}`);
      return found;
    };
    const oldDone = issue("REEF-002");
    expect(oldDone).toMatchObject({
      status: "done",
      last_status_change: "2020-01-01T00:00:00.000Z",
    });
    expect(oldDone.closed_at ?? null).toBeNull();
    expect(
      filterIssues([oldDone], {}, { staleWindowDays: { completed: 30 } }),
    ).toHaveLength(0);
    const oldClosed = issue("REEF-004");
    expect(oldClosed.last_status_change).toBe("2020-01-01T00:00:00.000Z");
    expect(
      filterIssues([oldClosed], {}, { staleWindowDays: { completed: 30 } }),
    ).toHaveLength(0);
    expect(
      isStaleResolved({
        status: oldDone.status,
        lastStatusChange: oldDone.last_status_change,
        now: Date.parse(MOVED_AT),
        completedWindowDays: 30,
      }),
    ).toBe(true);
    expect(
      isStaleResolved({
        status: oldClosed.status,
        lastStatusChange: oldClosed.last_status_change,
        now: Date.parse(MOVED_AT),
        completedWindowDays: 30,
      }),
    ).toBe(true);

    const report = computeAggregates([oldDone], {
      filters: { ...DEFAULT_REPORT_FILTERS, period: "12w", scope: "all" },
      now: Date.parse(MOVED_AT),
      throughputWeeks: 12,
    });
    expect(
      report.throughput.reduce((count, week) => count + week.closed, 0),
    ).toBe(0);

    const loggedNeighbor = issue("REEF-001");
    expect(loggedNeighbor.last_status_change).toBe("2026-06-01T00:00:00.000Z");
    expect(issue("REEF-003")).toMatchObject({
      status: "in_progress",
      last_status_change: MOVED_AT,
    });
    const activity = await akbListIssueActivity(
      adapter,
      REEF_VAULT,
      "REEF-001",
    );
    const timeline = buildTimeline([], activity, loggedNeighbor);
    const statusRows = timeline.filter(
      (entry) =>
        entry.type === "system" && entry.event.kind === "status_change",
    );
    expect(statusRows).toHaveLength(1);
    expect(
      statusRows[0]?.type === "system" ? statusRows[0].event.id : null,
    ).toBe("seed-status-reef-001");

    for (const reefId of ["REEF-001", "REEF-002", "REEF-003"]) {
      const row = vault.issues.find(
        (candidate) => candidate.reef_id === reefId,
      );
      expect(row?.meta).toMatchObject({
        last_editor: ACTOR,
        fixture_marker: `preserve:${reefId}`,
      });
    }
  });

  it("keeps status times on same-status and non-status-group reorder writes", async () => {
    const sameStatus = setupFixture([
      {
        reef_id: "REEF-001",
        status: "todo",
        rank: 1,
        last_status_change: "2026-05-01T00:00:00.000Z",
      },
      {
        reef_id: "REEF-002",
        status: "todo",
        rank: 1 + Number.EPSILON,
        last_status_change: null,
      },
      {
        reef_id: "REEF-003",
        status: "todo",
        rank: 3000,
        last_status_change: "missing",
      },
    ]);
    await reorderIssue({
      adapter: sameStatus.adapter,
      vault: REEF_VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: BEFORE_AT,
        beforeRank: 1,
        beforeUpdatedAt: BEFORE_AT,
        afterRank: 1 + Number.EPSILON,
        afterUpdatedAt: BEFORE_AT,
      },
      group: { field: "status", value: "todo" },
      actor: ACTOR,
      at: MOVED_AT,
    });
    expect(sameStatus.vault.activity).toHaveLength(0);
    expect(sameStatus.vault.issues.map((row) => row.meta)).toMatchObject([
      { last_status_change: "2026-05-01T00:00:00.000Z", last_editor: ACTOR },
      { last_status_change: null, last_editor: ACTOR },
      { last_editor: ACTOR },
    ]);
    expect(sameStatus.vault.issues[2]?.meta).not.toHaveProperty(
      "last_status_change",
    );

    const priorityGroup = setupFixture([
      {
        reef_id: "REEF-001",
        status: "todo",
        priority: "low",
        rank: 1,
        last_status_change: "2026-05-01T00:00:00.000Z",
      },
      {
        reef_id: "REEF-002",
        status: "todo",
        priority: "medium",
        rank: 1 + Number.EPSILON,
        last_status_change: null,
      },
      {
        reef_id: "REEF-003",
        status: "todo",
        priority: "low",
        rank: 3000,
        last_status_change: "missing",
      },
    ]);
    await reorderIssue({
      adapter: priorityGroup.adapter,
      vault: REEF_VAULT,
      scope: "active",
      issueId: "REEF-003",
      beforeId: "REEF-001",
      afterId: "REEF-002",
      expected: {
        issueRank: 3000,
        issueUpdatedAt: BEFORE_AT,
        beforeRank: 1,
        beforeUpdatedAt: BEFORE_AT,
        afterRank: 1 + Number.EPSILON,
        afterUpdatedAt: BEFORE_AT,
      },
      group: { field: "priority", value: "high" },
      actor: ACTOR,
      at: MOVED_AT,
    });
    expect(priorityGroup.vault.activity).toMatchObject([
      { reef_id: "REEF-003", event_type: "priority_change" },
    ]);
    expect(priorityGroup.vault.issues.map((row) => row.meta)).toMatchObject([
      { last_status_change: "2026-05-01T00:00:00.000Z", last_editor: ACTOR },
      { last_status_change: null, last_editor: ACTOR },
      { last_editor: ACTOR },
    ]);
    expect(priorityGroup.vault.issues[2]?.meta).not.toHaveProperty(
      "last_status_change",
    );
    expect(priorityGroup.vault.issues[2]?.priority).toBe("high");
  });

  it("applies the original unconditional status timestamp SQL to all touched rows", () => {
    const { state, vault } = setupFixture([
      {
        reef_id: "REEF-001",
        status: "todo",
        rank: 1000,
        last_status_change: "2020-01-01T00:00:00.000Z",
      },
      {
        reef_id: "REEF-002",
        status: "todo",
        rank: 2000,
        last_status_change: null,
      },
    ]);
    // This is the pre-REEF-655 nested jsonb_set shape. The harness must evaluate
    // it as written so the original multirow corruption remains reproducible.
    const sql = `WITH updated AS (UPDATE reef_issues SET "rank" = CASE "reef_id" WHEN 'REEF-001' THEN 1000 WHEN 'REEF-002' THEN 2000 ELSE "rank" END, "status" = CASE "reef_id" WHEN 'REEF-001' THEN 'in_progress' ELSE "status" END, "meta" = jsonb_set(jsonb_set(COALESCE("meta"::jsonb, '{}'::jsonb), '{last_editor}', to_jsonb('${ACTOR}'::text), true), '{last_status_change}', to_jsonb('${MOVED_AT}'::text), true)::json WHERE "reef_id" IN ('REEF-001', 'REEF-002') AND "archived_at" IS NULL AND "status" != 'backlog' RETURNING "reef_id", "rank", "updated_at") SELECT "reef_id", "rank", "updated_at" FROM updated`;

    handleSql(state, vault, sql, "alice");

    expect(vault.issues.map((row) => row.status)).toEqual([
      "in_progress",
      "todo",
    ]);
    expect(vault.issues.map((row) => row.meta.last_status_change)).toEqual([
      MOVED_AT,
      MOVED_AT,
    ]);
  });
});
