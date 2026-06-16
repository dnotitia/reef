// @vitest-environment node

import {
  AgentArtifactSchema,
  type AgentRunEvent,
  AgentRunEventSchema,
} from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  agentRunReducer,
  createInitialAgentRunState,
  isTerminalPhase,
} from "./reducer";

const issueDraftFields = {
  title: "Create stream client",
  issue_type: "task",
  priority: null,
  assigned_to: null,
  requester: null,
  reporter: null,
  start_date: null,
  due_date: null,
  milestone_id: null,
  sprint_id: null,
  release_id: null,
  estimate_points: null,
  severity: null,
  parent_id: null,
  labels: [],
  depends_on: [],
  blocks: [],
  related_to: [],
  external_refs: [],
};

const artifact = AgentArtifactSchema.parse({
  artifact_id: "artifact-1",
  run_id: "run-1",
  task_id: "activity.scan",
  type: "issue_create_proposal",
  status: "pending",
  title: "Create stream client",
  confidence: 0.9,
  reasoning: "Activity suggests a web runtime.",
  evidence: [],
  warnings: [],
  created_at: "2026-06-04T00:00:04.000Z",
  updated_at: null,
  metadata: {},
  payload: {
    proposal: {
      operation: "create" as const,
      create: {
        fields: issueDraftFields,
        content: "Implement shared runtime.",
      },
    },
  },
});

function event(input: Record<string, unknown>): AgentRunEvent {
  return AgentRunEventSchema.parse({
    event_id: `event-${input.seq}`,
    run_id: "run-1",
    task_id: "activity.scan",
    created_at: `2026-06-04T00:00:0${input.seq}.000Z`,
    metadata: {},
    ...input,
  });
}

describe("agentRunReducer", () => {
  it("replays stream events into deterministic run and artifact state", () => {
    const events = [
      event({ seq: 0, type: "run.started", run_status: "running", input: {} }),
      event({
        seq: 1,
        type: "stage.started",
        stage: { stage_id: "scan", name: "Scan activity" },
      }),
      event({
        seq: 2,
        type: "tool.called",
        tool: { tool_call_id: "tool-1", tool_name: "search_issues" },
        input: { query: "stream" },
      }),
      event({
        seq: 3,
        type: "model.delta",
        delta: "Hello ",
        channel: "text",
      }),
      event({
        seq: 4,
        type: "artifact.partial",
        artifact_id: "artifact-1",
        artifact_type: "issue_create_proposal",
        delta: { field: "title" },
      }),
      event({
        seq: 5,
        type: "artifact.final",
        artifact,
      }),
      event({
        seq: 6,
        type: "run.completed",
        run_status: "completed",
        artifact_ids: ["artifact-1"],
        usage: {},
      }),
    ];

    const replay = () =>
      events.reduce(
        (state, next) => agentRunReducer(state, { type: "event", event: next }),
        createInitialAgentRunState("activity.scan"),
      );

    const state = replay();
    expect(state).toEqual(replay());
    expect(state.phase).toBe("completed");
    expect(state.text).toBe("Hello ");
    expect(state.progress.stages.scan?.status).toBe("running");
    expect(state.progress.tools["tool-1"]?.input).toEqual({ query: "stream" });
    expect(state.artifact_order).toEqual(["artifact-1"]);
    expect(state.artifacts["artifact-1"]).toMatchObject({
      type: "issue_create_proposal",
      status: "pending",
    });
    expect(state.partial_artifacts["artifact-1"]).toBeUndefined();
  });

  it("distinguishes runtime errors from stream errors", () => {
    const runtimeState = agentRunReducer(createInitialAgentRunState(), {
      type: "event",
      event: event({
        seq: 0,
        type: "run.error",
        run_status: "error",
        error: {
          code: "workspace_chat_stream_error",
          message: "The model failed.",
          recoverable: false,
          details: {},
        },
      }),
    });

    const streamState = agentRunReducer(createInitialAgentRunState(), {
      type: "stream_error",
      error: {
        kind: "stream",
        code: "agent_run_stream_parse_error",
        message: "Bad SSE.",
        recoverable: true,
        details: {},
      },
    });

    expect(runtimeState.error?.kind).toBe("runtime");
    expect(runtimeState.error?.code).toBe("workspace_chat_stream_error");
    expect(streamState.error?.kind).toBe("stream");
  });

  it("identifies terminal phases", () => {
    expect(isTerminalPhase("running")).toBe(false);
    expect(isTerminalPhase("completed")).toBe(true);
    expect(isTerminalPhase("cancelled")).toBe(true);
  });
});
