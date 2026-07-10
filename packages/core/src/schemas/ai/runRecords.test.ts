import { describe, expect, it } from "vitest";
import {
  AgentExecutionStatusEnum,
  AgentRunAttemptSchema,
  AgentRunEventRecordSchema,
  AgentRunRecordSchema,
  AgentRunWithIssueStatusSchema,
  WorkEventSchema,
} from "./runRecords";

const timestamp = "2026-07-09T00:00:00.000Z";

const target = {
  repo: "dnotitia/reef",
  base_ref: "origin/main",
  branch: "feat/reef-380-agent-run-data-model",
  worktree_path: "/worktrees/reef-380-agent-run-data-model",
  head_sha: null,
  pull_request_url: null,
};

const run = {
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
  queued_at: timestamp,
  claimed_at: timestamp,
  started_at: timestamp,
  meta: { actor: "김영로" },
};

describe("agent execution record schemas", () => {
  it("fixes the durable run status enum separately from runtime phases", () => {
    expect(AgentExecutionStatusEnum.options).toEqual([
      "queued",
      "claimed",
      "running",
      "blocked",
      "failed",
      "cancelled",
      "succeeded",
    ]);

    expect(AgentRunRecordSchema.parse(run)).toMatchObject({
      status: "running",
      phase: "implement",
    });
  });

  it("uses state_updated_at for semantic run updates so AKB can own updated_at", () => {
    expect(
      AgentRunRecordSchema.parse({ ...run, state_updated_at: timestamp })
        .state_updated_at,
    ).toBe(timestamp);

    expect(() =>
      AgentRunRecordSchema.parse({ ...run, updated_at: timestamp }),
    ).toThrow();
  });

  it("holds one active issue slot only while the run is non-terminal", () => {
    expect(AgentRunRecordSchema.parse(run).active_reef_id).toBe("REEF-380");
    expect(() =>
      AgentRunRecordSchema.parse({ ...run, active_reef_id: null }),
    ).toThrow(/active slot/);
    expect(
      AgentRunRecordSchema.parse({
        ...run,
        status: "succeeded",
        phase: "terminal",
        active_reef_id: null,
        completed_at: timestamp,
      }).active_reef_id,
    ).toBeNull();
  });

  it("accepts only valid work event payloads at the core schema boundary", () => {
    expect(
      WorkEventSchema.parse({
        work_event_id: "work-1",
        reef_id: "REEF-380",
        event_type: "issue.claimed",
        event_key: "issue.claimed:REEF-380@2026-07-09T00:00:00.000Z",
        occurred_at: timestamp,
        payload: { from_status: "todo", to_status: "in_progress" },
      }),
    ).toMatchObject({ reef_id: "REEF-380" });

    expect(() =>
      WorkEventSchema.parse({
        work_event_id: "work-1",
        reef_id: "REEF-380",
        event_type: "issue.claimed",
        occurred_at: timestamp,
        payload: "not-an-object",
      }),
    ).toThrow();
  });

  it("keeps issue lifecycle status separate from durable run status", () => {
    const item = AgentRunWithIssueStatusSchema.parse({
      run,
      issue_status: "in_review",
    });

    expect(item.issue_status).toBe("in_review");
    expect(item.run.status).toBe("running");
    expect(item.run.phase).toBe("implement");
  });

  it("uses emitted_at for durable run event time so AKB can own created_at", () => {
    const event = AgentRunEventRecordSchema.parse({
      run_event_id: "event-1",
      run_id: "run-reef-380",
      attempt_id: "attempt-1",
      seq: 0,
      event_type: "phase.started",
      phase: "implement",
      emitted_at: timestamp,
      payload: { message: "implementation started" },
    });

    expect(event.emitted_at).toBe(timestamp);
    expect("created_at" in event).toBe(false);
  });

  it("preserves multiple attempts for the same run as separate records", () => {
    const attempts = [
      AgentRunAttemptSchema.parse({
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
      }),
      AgentRunAttemptSchema.parse({
        attempt_id: "attempt-2",
        run_id: "run-reef-380",
        attempt_number: 2,
        status: "succeeded",
        phase: "terminal",
        target,
        started_at: "2026-07-09T00:06:00.000Z",
        completed_at: "2026-07-09T00:10:00.000Z",
        result: { gates: "green" },
      }),
    ];

    expect(attempts.map((attempt) => attempt.result)).toEqual([
      { gates: "red" },
      { gates: "green" },
    ]);
  });
});
