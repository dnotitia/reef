import { describe, expect, it } from "vitest";
import {
  AgentRunAttemptSchema,
  AgentRunEventRecordSchema,
  AgentRunRecordSchema,
  WorkEventSchema,
} from "../schemas/ai/runRecords";
import {
  ALL_REEF_TABLES,
  REEF_DESIRED_TABLES,
  appendAgentRunEvent,
  appendWorkEvent,
  createQueuedIssueRun,
  listAgentRunAttempts,
  makeAdapter,
  makeListTablesResponse,
  makeSchemaVersionResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  readActiveAgentRunForIssue,
  readAgentRunWithIssueStatus,
  setupFetch,
  writeAgentRun,
  writeAgentRunAttempt,
} from "./akb.testSupport";

const timestamp = "2026-07-09T00:00:00.000Z";

const target = {
  repo: "dnotitia/reef",
  base_ref: "origin/main",
  branch: "feat/reef-380-agent-run-data-model",
  worktree_path: "/worktrees/reef-380-agent-run-data-model",
  head_sha: null,
  pull_request_url: null,
};

const runRow = AgentRunRecordSchema.parse({
  run_id: "run-reef-380",
  reef_id: "REEF-380",
  active_reef_id: "REEF-380",
  work_event_id: "work-1",
  task_id: "reef.issue.run",
  vault: "reef-test",
  status: "running",
  phase: "implement",
  attempt_number: 1,
  target,
  input: { issue_id: "REEF-380" },
  result: null,
  error: null,
  queued_at: timestamp,
  claimed_at: timestamp,
  started_at: timestamp,
  completed_at: null,
  state_updated_at: timestamp,
  meta: { actor: "김영로" },
});

const attemptRow = AgentRunAttemptSchema.parse({
  attempt_id: "attempt-1",
  run_id: "run-reef-380",
  attempt_number: 1,
  status: "failed",
  phase: "converge",
  target,
  started_at: timestamp,
  completed_at: "2026-07-09T00:05:00.000Z",
  result: { gates: "red" },
  error: {
    code: "gate_failed",
    message: "typecheck failed",
    recoverable: true,
  },
  meta: { round: 1 },
});

const workEvent = WorkEventSchema.parse({
  work_event_id: "work-1",
  reef_id: "REEF-380",
  event_type: "issue.claimed",
  event_key: "issue.claimed@2026-07-09T00:00:00.000Z",
  occurred_at: timestamp,
  payload: { status: "in_progress" },
});

const runEvent = AgentRunEventRecordSchema.parse({
  run_event_id: "run-event-1",
  run_id: "run-reef-380",
  attempt_id: "attempt-1",
  seq: 0,
  event_type: "phase.started",
  phase: "implement",
  emitted_at: timestamp,
  payload: { message: "implementation started" },
});

const queuedRun = AgentRunRecordSchema.parse({
  ...runRow,
  run_id: "run-request-1",
  work_event_id: "work-request-1",
  status: "queued",
  phase: "queued",
  claimed_at: null,
  started_at: null,
  state_updated_at: timestamp,
});

const requestedEvent = WorkEventSchema.parse({
  work_event_id: "work-request-1",
  reef_id: "REEF-380",
  event_type: "issue.run.requested",
  event_key: "issue.run.requested:request-1",
  occurred_at: timestamp,
  payload: { run_id: "run-request-1", github_id: 123 },
  meta: { actor: "김영로", source: "reef-web:issue-run" },
});

function desiredTablesResponse() {
  return {
    kind: "table",
    vault: "reef-sample",
    items: REEF_DESIRED_TABLES.map((manifest) => ({
      name: manifest.name,
      columns: manifest.columns,
      unique_keys: manifest.unique_keys ?? [],
    })),
  };
}

function sqlAt(calls: ReturnType<typeof setupFetch>["calls"], index: number) {
  return JSON.parse(String(calls[index]?.init?.body)).sql as string;
}

describe("akb agent run records", () => {
  it("creates a queued run and request event in one atomic CTE", async () => {
    const { calls } = setupFetch([
      { body: desiredTablesResponse() },
      {
        body: makeSqlQueryResponse(
          [{ value: JSON.stringify({ version: 4 }) }],
          ["value"],
        ),
      },
      { body: makeSqlQueryResponse([queuedRun], Object.keys(queuedRun)) },
    ]);

    const result = await createQueuedIssueRun({
      adapter: makeAdapter(),
      vault: "reef-sample",
      run: queuedRun,
      event: requestedEvent,
    });

    expect(result.kind).toBe("created");
    const sql = sqlAt(calls, 2);
    expect(sql).toContain("WITH inserted_run AS");
    expect(sql).toContain("INSERT INTO reef_agent_runs");
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).toContain(
      "status IN ('queued', 'claimed', 'running', 'blocked')",
    );
    expect(sql).toContain("ON CONFLICT DO NOTHING RETURNING *");
    expect(sql).toContain("INSERT INTO reef_work_events");
    expect(sql).toContain("FROM inserted_run");
    expect(sql).not.toContain("UPDATE reef_issues");
  });

  it("treats a migrated legacy non-terminal row without an active slot as active", async () => {
    const legacyRow = { ...runRow, active_reef_id: null };
    const { calls } = setupFetch([
      { body: desiredTablesResponse() },
      { body: makeSchemaVersionResponse() },
      { body: makeSqlQueryResponse([legacyRow], Object.keys(legacyRow)) },
    ]);

    await expect(
      readActiveAgentRunForIssue({
        adapter: makeAdapter(),
        vault: "reef-sample",
        reefId: "REEF-380",
      }),
    ).resolves.toMatchObject({
      run: { run_id: "run-reef-380", active_reef_id: "REEF-380" },
    });
    expect(sqlAt(calls, 2)).toContain("active_reef_id IS NULL");
    expect(sqlAt(calls, 2)).toContain(
      "status IN ('queued', 'claimed', 'running', 'blocked')",
    );
  });

  it("distinguishes a same-request replay from another active request", async () => {
    setupFetch([
      { body: desiredTablesResponse() },
      {
        body: makeSqlQueryResponse(
          [{ value: JSON.stringify({ version: 4 }) }],
          ["value"],
        ),
      },
      { body: makeSqlQueryResponse([], []) },
      { body: makeSqlQueryResponse([queuedRun], Object.keys(queuedRun)) },
    ]);
    await expect(
      createQueuedIssueRun({
        adapter: makeAdapter(),
        vault: "reef-sample",
        run: queuedRun,
        event: requestedEvent,
      }),
    ).resolves.toMatchObject({ kind: "replayed" });

    const conflicting = AgentRunRecordSchema.parse({
      ...queuedRun,
      run_id: "run-request-2",
      work_event_id: "work-request-2",
    });
    setupFetch([
      { body: desiredTablesResponse() },
      {
        body: makeSqlQueryResponse(
          [{ value: JSON.stringify({ version: 4 }) }],
          ["value"],
        ),
      },
      { body: makeSqlQueryResponse([], []) },
      { body: makeSqlQueryResponse([queuedRun], Object.keys(queuedRun)) },
    ]);
    await expect(
      createQueuedIssueRun({
        adapter: makeAdapter(),
        vault: "reef-sample",
        run: conflicting,
        event: WorkEventSchema.parse({
          ...requestedEvent,
          work_event_id: "work-request-2",
          event_key: "issue.run.requested:request-2",
        }),
      }),
    ).resolves.toMatchObject({ kind: "conflict", run: queuedRun });
  });

  it("scopes work-event idempotency by reef_id and event_key", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await appendWorkEvent({
      adapter: makeAdapter(),
      vault: "reef-sample",
      event: workEvent,
    });

    const insertSql = sqlAt(calls, 1);
    expect(insertSql).toContain("INSERT INTO reef_work_events");
    expect(insertSql).toContain("WHERE reef_id = 'REEF-380'");
    expect(insertSql).toContain(
      "AND event_key = 'issue.claimed@2026-07-09T00:00:00.000Z'",
    );
  });

  it("writes agent run rows without touching the issue lifecycle status", async () => {
    const { calls } = setupFetch([
      { body: desiredTablesResponse() },
      { body: makeSchemaVersionResponse() },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await writeAgentRun({
      adapter: makeAdapter(),
      vault: "reef-sample",
      run: runRow,
    });

    const sql = sqlAt(calls, 2);
    expect(sql).toContain("WITH updated AS (UPDATE reef_agent_runs");
    expect(sql).toContain("WHERE run_id = 'run-reef-380' RETURNING run_id");
    expect(sql).toContain("INSERT INTO reef_agent_runs");
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM updated)");
    expect(sql).toContain('"status"');
    expect(sql).toContain('"phase"');
    expect(sql).toContain('"state_updated_at"');
    expect(sql).not.toContain('"updated_at"');
    expect(sql).toContain("'2026-07-09T00:00:00.000Z'");
    expect(sql).not.toContain("DELETE FROM reef_agent_runs");
    expect(sql).not.toContain("ON CONFLICT");
    expect(sql).not.toContain("UPDATE reef_issues");
  });

  it("writes durable run events with emitted_at instead of reserved created_at", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await appendAgentRunEvent({
      adapter: makeAdapter(),
      vault: "reef-sample",
      event: runEvent,
    });

    const insertSql = sqlAt(calls, 1);
    expect(insertSql).toContain("INSERT INTO reef_agent_run_events");
    expect(insertSql).toContain('"emitted_at"');
    expect(insertSql).not.toContain('"created_at"');
  });

  it("reads issue status and run status as distinct lifecycle fields", async () => {
    setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [{ ...runRow, issue_status: "in_review" }],
          ["run_id", "reef_id", "status", "phase", "issue_status"],
        ),
      },
    ]);

    const { item } = await readAgentRunWithIssueStatus({
      adapter: makeAdapter(),
      vault: "reef-sample",
      runId: "run-reef-380",
    });

    expect(item.issue_status).toBe("in_review");
    expect(item.run.status).toBe("running");
    expect(item.run.phase).toBe("implement");
  });

  it("updates one attempt by attempt_id so a later attempt cannot overwrite prior results", async () => {
    const secondAttempt = AgentRunAttemptSchema.parse({
      ...attemptRow,
      attempt_id: "attempt-2",
      attempt_number: 2,
      status: "succeeded",
      phase: "terminal",
      result: { gates: "green" },
      error: null,
      completed_at: "2026-07-09T00:10:00.000Z",
    });
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [attemptRow, secondAttempt],
          ["attempt_id", "run_id", "attempt_number", "status", "phase"],
        ),
      },
    ]);

    await writeAgentRunAttempt({
      adapter: makeAdapter(),
      vault: "reef-sample",
      attempt: secondAttempt,
    });
    const { attempts } = await listAgentRunAttempts({
      adapter: makeAdapter(),
      vault: "reef-sample",
      runId: "run-reef-380",
    });

    const deleteSql = sqlAt(calls, 1);
    expect(deleteSql).toContain("WHERE attempt_id = 'attempt-2'");
    expect(deleteSql).not.toContain("WHERE run_id =");
    expect(attempts.map((attempt) => attempt.result)).toEqual([
      { gates: "red" },
      { gates: "green" },
    ]);
  });
});
