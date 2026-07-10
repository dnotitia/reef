import { describe, expect, it } from "vitest";
import {
  AgentRunAttemptSchema,
  AgentRunEventRecordSchema,
  AgentRunRecordSchema,
  WorkEventSchema,
} from "../schemas/ai/runRecords";
import {
  ALL_REEF_TABLES,
  appendAgentRunEvent,
  appendWorkEvent,
  listAgentRunAttempts,
  makeAdapter,
  makeListTablesResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
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

function sqlAt(calls: ReturnType<typeof setupFetch>["calls"], index: number) {
  return JSON.parse(String(calls[index]?.init?.body)).sql as string;
}

describe("akb agent run records", () => {
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
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlMutationResponse("DELETE 0") },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await writeAgentRun({
      adapter: makeAdapter(),
      vault: "reef-sample",
      run: runRow,
    });

    expect(sqlAt(calls, 1)).toContain("DELETE FROM reef_agent_runs");
    expect(sqlAt(calls, 1)).toContain("WHERE run_id = 'run-reef-380'");
    expect(sqlAt(calls, 2)).toContain("INSERT INTO reef_agent_runs");
    expect(sqlAt(calls, 2)).toContain('"status"');
    expect(sqlAt(calls, 2)).toContain('"phase"');
    expect(sqlAt(calls, 2)).toContain('"state_updated_at"');
    expect(sqlAt(calls, 2)).not.toContain('"updated_at"');
    expect(sqlAt(calls, 2)).toContain("'2026-07-09T00:00:00.000Z'");
    expect(sqlAt(calls, 2)).not.toContain("UPDATE reef_issues");
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
