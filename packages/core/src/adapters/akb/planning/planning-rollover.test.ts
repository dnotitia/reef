import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  activityEvents,
  ensureTables,
  issueRows,
  issueState,
  phaseFailure,
  readIssueMock,
  runSqlMock,
  selectIssueRowsMock,
  selectPlanningRowsMock,
  updateIssueMock,
} = vi.hoisted(() => ({
  activityEvents: [] as unknown[],
  ensureTables: vi.fn(),
  issueRows: [] as Record<string, unknown>[],
  issueState: new Map<string, Record<string, unknown>>(),
  phaseFailure: {
    current: null as
      | "target_preparation"
      | "source_close"
      | "target_activation"
      | null,
  },
  readIssueMock: vi.fn(),
  runSqlMock: vi.fn(),
  selectIssueRowsMock: vi.fn(),
  selectPlanningRowsMock: vi.fn(),
  updateIssueMock: vi.fn(),
}));

vi.mock("../core/shared", async () => {
  const actual =
    await vi.importActual<typeof import("../core/shared")>("../core/shared");
  return {
    ...actual,
    ensureReefTables: ensureTables,
    runSql: runSqlMock,
    selectIssueRows: selectIssueRowsMock,
  };
});

vi.mock("./planningRows", async () => {
  const actual =
    await vi.importActual<typeof import("./planningRows")>("./planningRows");
  return { ...actual, selectPlanningRows: selectPlanningRowsMock };
});

vi.mock("../issues/activity", async () => {
  const actual =
    await vi.importActual<typeof import("../issues/activity")>(
      "../issues/activity",
    );
  return {
    ...actual,
    appendActivityEvents: vi.fn(async (_adapter, _vault, events) => {
      activityEvents.push(...events);
    }),
  };
});

vi.mock("../issues/issues", async () => {
  const actual =
    await vi.importActual<typeof import("../issues/issues")>(
      "../issues/issues",
    );
  return {
    ...actual,
    readIssue: readIssueMock,
    updateIssue: updateIssueMock,
  };
});

import {
  closeSprintAndRollover,
  listSprintRolloverResumes,
  REEF_SPRINTS_TABLE,
} from "../index";
import { ConflictError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { makeIssueRow } from "../issues/issueFixtures";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TARGET_ID = "33333333-3333-4333-8333-333333333333";
const NEW_TARGET_ID = "44444444-4444-4444-8444-444444444444";
const AT = "2026-09-07T10:00:00.000Z";

function sprintRow(
  id: string,
  status: "planned" | "active" | "closed",
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name: id === SOURCE_ID ? "Sprint 14" : "Sprint 15",
    status,
    start_date: "2026-09-04",
    end_date: "2026-09-11",
    goal: "",
    capacity_points: null,
    meta: {},
    ...overrides,
  };
}

function issue(id: string, status: IssueMetadata["status"]): IssueMetadata {
  return {
    id,
    title: id,
    status,
    created_at: "2026-09-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-09-07T09:00:00.000Z",
    updated_by: "alice",
    priority: "high",
    assigned_to: "alice",
    requester: "alice",
    milestone_id: "milestone-1",
    release_id: "release-1",
    sprint_id: SOURCE_ID,
    labels: ["planning"],
    depends_on: [],
    related_to: [],
    blocks: [],
  };
}

function seed({ otherActive = false } = {}) {
  const source = sprintRow(SOURCE_ID, "active");
  const target = sprintRow(TARGET_ID, "planned");
  const otherTarget = sprintRow(OTHER_TARGET_ID, "planned", {
    name: "Sprint 16",
  });
  if (otherActive) otherTarget.status = "active";
  const rows = [source, target, otherTarget];
  const sourceIssues = [
    issue("REEF-001", "todo"),
    issue("REEF-002", "in_progress"),
    issue("REEF-003", "in_review"),
    issue("REEF-004", "done"),
    issue("REEF-005", "closed"),
    issue("REEF-006", "backlog"),
    issue("REEF-007", "todo"),
  ];
  const archived = sourceIssues.at(-1);
  if (!archived) throw new Error("fixture requires an archived issue");
  archived.archived_at = "2026-09-01T00:00:00.000Z";
  issueRows.push(...sourceIssues.map((item) => makeIssueRow(item)));
  for (const item of sourceIssues) issueState.set(item.id, { issue: item });

  selectPlanningRowsMock.mockImplementation(
    async (_adapter, _vault, table, where, params) => {
      if (table !== REEF_SPRINTS_TABLE) return [];
      if (String(where).includes("status =")) {
        return rows.filter(
          (row) =>
            row.status === "active" && (otherActive || row.id === SOURCE_ID),
        );
      }
      if (where === undefined) return rows;
      const id = Array.isArray(params) ? params[0] : undefined;
      return rows.filter((row) => row.id === id);
    },
  );
  selectIssueRowsMock.mockImplementation(async () => issueRows);
  readIssueMock.mockImplementation(async ({ id }: { id: string }) => {
    const current = issueState.get(id)?.issue as IssueMetadata | undefined;
    if (!current) throw new Error(`missing ${id}`);
    return {
      issue: current,
      path: `issues/${id}.md`,
      commit_hash: null,
      content: "",
    };
  });
  updateIssueMock.mockImplementation(
    async ({
      id,
      partial,
    }: {
      id: string;
      partial: Partial<IssueMetadata>;
    }) => {
      const current = issueState.get(id)?.issue as IssueMetadata;
      issueState.set(id, {
        issue: {
          ...current,
          ...partial,
          updated_at: partial.updated_at ?? current.updated_at,
        },
      });
      return { issue: issueState.get(id)?.issue, commit_hash: "", content: "" };
    },
  );
  runSqlMock.mockImplementation(
    async (_adapter, _vault, sql: string, params: readonly unknown[]) => {
      if (sql.includes("INSERT INTO reef_sprints")) {
        if (phaseFailure.current === "target_preparation") {
          throw new Error("target preparation failed");
        }
        const newTarget = sprintRow(NEW_TARGET_ID, "planned", {
          name: "New Sprint",
          start_date: "2026-09-12",
          end_date: "2026-09-19",
        });
        rows.push(newTarget);
        return {
          kind: "table_query",
          columns: [],
          items: [newTarget],
          total: 1,
        };
      }
      if (!sql.includes("UPDATE reef_sprints")) {
        return { kind: "table_sql", result: "UPDATE 1" };
      }
      if (
        phaseFailure.current === "source_close" &&
        sql.includes("SET status = $1")
      ) {
        throw new Error("source close failed");
      }
      if (
        phaseFailure.current === "target_activation" &&
        sql.includes("SET status = 'active'")
      ) {
        throw new Error("target activation failed");
      }
      const jsonParam = params.find(
        (value) =>
          typeof value === "string" && String(value).includes("operation_key"),
      );
      const state = jsonParam ? JSON.parse(String(jsonParam)) : null;
      const sourceRow = rows.find((row) => row.id === SOURCE_ID);
      if (sql.includes("SET status = 'active'")) {
        const targetId = String(params.at(-1));
        const targetRow = rows.find((row) => row.id === targetId);
        if (!targetRow)
          throw new Error("fixture target planning row is missing");
        targetRow.status = "active";
        return {
          kind: "table_query",
          columns: [],
          items: [targetRow],
          total: 1,
        };
      }
      if (!sourceRow) throw new Error("fixture source planning row is missing");
      if (sql.includes("SET status = $1")) {
        sourceRow.status = "closed";
        sourceRow.end_date = String(params[1]);
        sourceRow.meta = { sprint_rollover: state };
      } else if (state) {
        sourceRow.meta = {
          ...(sourceRow.meta as object),
          sprint_rollover: state,
        };
      }
      return {
        kind: "table_query",
        columns: [],
        items: [sourceRow],
        total: 1,
      };
    },
  );
}

const adapter = { request: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  issueRows.length = 0;
  issueState.clear();
  activityEvents.length = 0;
  phaseFailure.current = null;
  seed();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("closeSprintAndRollover", () => {
  it("lists an incomplete existing-target claim for browser resume", async () => {
    phaseFailure.current = "target_activation";
    const first = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });
    expect(first.status).toBe("partial");

    const resumes = await listSprintRolloverResumes({
      adapter,
      vault: "reef-sample",
    });

    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toMatchObject({
      end_date: "2026-09-11",
      target: { kind: "existing", id: TARGET_ID },
      result: {
        status: "partial",
        source_sprint_id: SOURCE_ID,
        target_sprint_id: TARGET_ID,
      },
    });
    expect(resumes[0]).not.toHaveProperty("actor");
    expect(resumes[0]).not.toHaveProperty("source");
  });

  it("reconstructs a newly created target request for browser resume", async () => {
    phaseFailure.current = "target_activation";
    const first = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: {
        kind: "new",
        item: {
          name: "New Sprint",
          status: "planned",
          start_date: "2026-09-12",
          end_date: "2026-09-19",
          goal: "",
          capacity_points: null,
        },
      },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });
    expect(first.status).toBe("partial");

    const resumes = await listSprintRolloverResumes({
      adapter,
      vault: "reef-sample",
    });

    expect(resumes[0]?.target).toEqual({
      kind: "new",
      item: {
        name: "New Sprint",
        status: "planned",
        start_date: "2026-09-12",
        end_date: "2026-09-19",
        goal: "",
        capacity_points: null,
      },
    });
  });

  it("persists a target-preparation claim and resumes after creation fails", async () => {
    phaseFailure.current = "target_preparation";
    const input = {
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: {
        kind: "new" as const,
        item: {
          name: "New Sprint",
          status: "planned" as const,
          start_date: "2026-09-12",
          end_date: "2026-09-19",
          goal: "",
          capacity_points: null,
        },
      },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover" as const,
      now: AT,
    };

    const first = await closeSprintAndRollover(input);
    expect(first.status).toBe("blocked");
    expect(first.phases.target_preparation).toBe("failed");
    expect(first.target_sprint_id).toBeNull();
    expect(updateIssueMock).not.toHaveBeenCalled();

    phaseFailure.current = null;
    const retry = await closeSprintAndRollover(input);
    expect(retry.status).toBe("completed");
    expect(retry.target_sprint?.status).toBe("active");
    expect(updateIssueMock).toHaveBeenCalledTimes(3);
  });

  it("creates a planned target through the idempotent create path", async () => {
    const result = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: {
        kind: "new",
        item: {
          name: "New Sprint",
          status: "planned",
          start_date: "2026-09-12",
          end_date: "2026-09-19",
          goal: "",
          capacity_points: null,
        },
      },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });

    expect(result.status).toBe("completed");
    expect(result.target_sprint).toMatchObject({
      id: NEW_TARGET_ID,
      name: "New Sprint",
      status: "active",
    });
  });

  it("does not start issue moves when source close fails, then resumes", async () => {
    phaseFailure.current = "source_close";
    const first = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });
    expect(first.status).toBe("blocked");
    expect(first.phases.source_close).toBe("failed");
    expect(updateIssueMock).not.toHaveBeenCalled();
    expect(first.source_sprint.status).toBe("active");

    phaseFailure.current = null;
    const retry = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });
    expect(retry.status).toBe("completed");
    expect(updateIssueMock).toHaveBeenCalledTimes(3);
  });

  it("does not start issue moves when target activation fails, then resumes", async () => {
    phaseFailure.current = "target_activation";
    const first = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });
    expect(first.status).toBe("partial");
    expect(first.phases.source_close).toBe("completed");
    expect(first.phases.target_activation).toBe("failed");
    expect(updateIssueMock).not.toHaveBeenCalled();

    phaseFailure.current = null;
    const retry = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });
    expect(retry.status).toBe("completed");
    expect(updateIssueMock).toHaveBeenCalledTimes(3);
  });

  it("closes the source, activates the chosen target, moves only eligible issues, and records links", async () => {
    const result = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });

    if (result.status !== "completed") {
      throw new Error(JSON.stringify(result));
    }
    expect(result.counts).toMatchObject({
      eligible: 3,
      done: 1,
      closed: 1,
      backlog: 1,
      archived: 1,
      moved: 3,
      failed: 0,
      conflicts: 0,
    });
    expect(result.source_sprint.status).toBe("closed");
    expect(result.target_sprint?.status).toBe("active");
    const activationSql = runSqlMock.mock.calls
      .map((call) => String(call[2]))
      .find((sql) => sql.includes("SET status = 'active'"));
    expect(activationSql).toContain("pg_advisory_xact_lock");
    expect(activationSql).toContain("NOT EXISTS");
    expect(updateIssueMock).toHaveBeenCalledTimes(3);
    expect(updateIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "REEF-001",
        expectedUpdatedAt: "2026-09-07T09:00:00.000Z",
        partial: expect.objectContaining({
          sprint_id: TARGET_ID,
          updated_by: "alice",
          source: "user:sprint_rollover",
        }),
      }),
    );
    expect(issueState.get("REEF-001")?.issue).toMatchObject({
      status: "todo",
      assigned_to: "alice",
      milestone_id: "milestone-1",
      release_id: "release-1",
      sprint_id: TARGET_ID,
    });
    expect(activityEvents).toHaveLength(3);
    expect(activityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "planning_link",
          payload: { field: "sprint", from: SOURCE_ID, to: TARGET_ID },
          actor: "alice",
          source: "user:sprint_rollover",
          at: AT,
        }),
      ]),
    );
  });

  it("uses the durable completion claim as a no-op on a repeated request", async () => {
    const input = {
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing" as const, id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover" as const,
      now: AT,
    };
    await closeSprintAndRollover(input);
    const updateCount = updateIssueMock.mock.calls.length;
    const eventCount = activityEvents.length;

    const retry = await closeSprintAndRollover(input);

    expect(retry.no_op).toBe(true);
    expect(retry.status).toBe("completed");
    expect(updateIssueMock).toHaveBeenCalledTimes(updateCount);
    expect(activityEvents).toHaveLength(eventCount);
  });

  it("surfaces an activity append failure and repairs it on the same-target retry", async () => {
    const activity = await import("../issues/activity");
    const append = vi.mocked(activity.appendActivityEvents);
    append.mockRejectedValueOnce(new Error("activity unavailable"));

    const first = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });

    expect(first.status).toBe("partial");
    expect(first.counts.failed).toBe(1);
    expect(first.issue_results).toContainEqual(
      expect.objectContaining({
        id: "REEF-001",
        disposition: "failed",
        activity: "pending",
        reason: "activity_pending",
      }),
    );

    const retry = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });
    expect(retry.status).toBe("completed");
    expect(retry.counts).toMatchObject({ moved: 3, failed: 0 });
  });

  it("skips a candidate that becomes done after preview instead of overwriting it", async () => {
    updateIssueMock.mockImplementationOnce(async () => {
      const current = issueState.get("REEF-001")?.issue as IssueMetadata;
      issueState.set("REEF-001", {
        issue: { ...current, status: "done" },
      });
      throw new ConflictError();
    });

    const result = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });

    if (result.status !== "completed") {
      throw new Error(JSON.stringify(result));
    }
    expect(result.issue_results).toContainEqual(
      expect.objectContaining({
        id: "REEF-001",
        disposition: "skipped",
        reason: "status_done",
      }),
    );
    expect((issueState.get("REEF-001")?.issue as IssueMetadata).sprint_id).toBe(
      SOURCE_ID,
    );
  });

  it("surfaces a persistent row revision conflict instead of a false success", async () => {
    let conflictEnabled = true;
    updateIssueMock.mockImplementation(
      async ({
        id,
        partial,
      }: {
        id: string;
        partial: Partial<IssueMetadata>;
      }) => {
        if (conflictEnabled && id === "REEF-001") throw new ConflictError();
        const current = issueState.get(id)?.issue as IssueMetadata;
        issueState.set(id, {
          issue: {
            ...current,
            ...partial,
            updated_at: partial.updated_at ?? current.updated_at,
          },
        });
        return {
          issue: issueState.get(id)?.issue,
          commit_hash: "",
          content: "",
        };
      },
    );

    const result = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });

    expect(result.status).toBe("partial");
    expect(result.counts).toMatchObject({ moved: 2, conflicts: 1, failed: 0 });
    expect(result.issue_results).toContainEqual(
      expect.objectContaining({
        id: "REEF-001",
        disposition: "conflict",
        reason: "row_conflict",
      }),
    );

    conflictEnabled = false;
    const retry = await closeSprintAndRollover({
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing", id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover",
      now: AT,
    });

    expect(retry.status).toBe("completed");
    expect(retry.counts).toMatchObject({ moved: 3, conflicts: 0, failed: 0 });
  });

  it("names an unrelated active sprint before changing the source", async () => {
    seed({ otherActive: true });

    await expect(
      closeSprintAndRollover({
        adapter,
        vault: "reef-sample",
        sourceSprintId: SOURCE_ID,
        target: { kind: "existing", id: TARGET_ID },
        endDate: "2026-09-11",
        actor: "alice",
        source: "user:sprint_rollover",
        now: AT,
      }),
    ).rejects.toMatchObject({
      name: "ConflictError",
      context: {
        code: "planning.sprintRollover.activeConflict",
        params: { sprintName: "Sprint 16" },
        path: `planning/sprints/${OTHER_TARGET_ID}`,
      },
    });
    expect(updateIssueMock).not.toHaveBeenCalled();
    expect(activityEvents).toHaveLength(0);
  });

  it("rejects a different target after the source claim is durable", async () => {
    const input = {
      adapter,
      vault: "reef-sample",
      sourceSprintId: SOURCE_ID,
      target: { kind: "existing" as const, id: TARGET_ID },
      endDate: "2026-09-11",
      actor: "alice",
      source: "user:sprint_rollover" as const,
      now: AT,
    };
    await closeSprintAndRollover(input);

    await expect(
      closeSprintAndRollover({
        ...input,
        target: { kind: "existing", id: OTHER_TARGET_ID },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
