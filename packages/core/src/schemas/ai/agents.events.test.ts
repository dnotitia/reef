import { describe, expect, it } from "vitest";
import {
  AgentArtifactSchema,
  AgentRunEnvelopeSchema,
  AgentRunEventSchema,
} from "./agents";
import { baseArtifact, timestamp } from "./agents.testSupport";

describe("agent run event schemas", () => {
  it("parses lifecycle events for stages, tools, model deltas, repairs, artifacts, and completion", () => {
    const events = [
      {
        event_id: "event-1",
        run_id: "run-1",
        task_id: "issue.enrichment",
        seq: 0,
        created_at: timestamp,
        type: "run.started",
        run_status: "running",
      },
      {
        event_id: "event-2",
        run_id: "run-1",
        task_id: "issue.enrichment",
        seq: 1,
        created_at: timestamp,
        type: "stage.started",
        stage: { stage_id: "prepareContext", name: "Prepare context" },
      },
      {
        event_id: "event-3",
        run_id: "run-1",
        task_id: "issue.enrichment",
        seq: 2,
        created_at: timestamp,
        type: "tool.called",
        tool: { tool_call_id: "tool-1", tool_name: "read_issue" },
        input: { issue_id: "REEF-036" },
      },
      {
        event_id: "event-4",
        run_id: "run-1",
        task_id: "issue.enrichment",
        seq: 3,
        created_at: timestamp,
        type: "model.delta",
        delta: "suggest",
      },
      {
        event_id: "event-5",
        run_id: "run-1",
        task_id: "issue.enrichment",
        seq: 4,
        created_at: timestamp,
        type: "repair.started",
        repair: { attempt: 1, reason: "Invalid JSON", policy: "json-repair" },
      },
      {
        event_id: "event-6",
        run_id: "run-1",
        task_id: "issue.enrichment",
        seq: 5,
        created_at: timestamp,
        type: "artifact.final",
        artifact: {
          ...baseArtifact,
          type: "field_suggestion",
          payload: {
            issue_id: "REEF-036",
            suggestions: [
              {
                field: "title",
                value: "Agent runtime event model",
                reasoning: "Clearer title.",
                confidence: 0.9,
              },
            ],
          },
        },
      },
      {
        event_id: "event-7",
        run_id: "run-1",
        task_id: "issue.enrichment",
        seq: 6,
        created_at: timestamp,
        type: "run.completed",
        run_status: "completed",
        artifact_ids: ["artifact-1"],
      },
    ];

    expect(
      events.map((event) => AgentRunEventSchema.parse(event)),
    ).toHaveLength(7);
  });

  it("rejects standalone final events whose artifact belongs to another run", () => {
    expect(() =>
      AgentRunEventSchema.parse({
        event_id: "event-1",
        run_id: "run-1",
        task_id: "chat.workspace",
        seq: 0,
        created_at: timestamp,
        type: "artifact.final",
        artifact: {
          ...baseArtifact,
          run_id: "run-2",
          task_id: "chat.workspace",
          type: "chat_message",
          payload: {
            text: "Wrong run.",
          },
        },
      }),
    ).toThrow("artifact run_id must match event run_id");
  });

  it("parses a run envelope with shared events and artifacts", () => {
    const envelope = AgentRunEnvelopeSchema.parse({
      run_id: "run-1",
      task_id: "chat.workspace",
      status: "completed",
      started_at: timestamp,
      completed_at: timestamp,
      events: [
        {
          event_id: "event-1",
          run_id: "run-1",
          task_id: "chat.workspace",
          seq: 0,
          created_at: timestamp,
          type: "run.completed",
          run_status: "completed",
        },
      ],
      artifacts: [
        {
          ...baseArtifact,
          task_id: "chat.workspace",
          type: "chat_message",
          payload: {
            text: "I found three related issues.",
          },
        },
      ],
    });

    expect(envelope.status).toBe("completed");
    expect(envelope.artifacts[0]?.type).toBe("chat_message");
  });

  it("rejects envelopes that mix events or artifacts from other runs", () => {
    expect(() =>
      AgentRunEnvelopeSchema.parse({
        run_id: "run-1",
        task_id: "chat.workspace",
        status: "completed",
        started_at: timestamp,
        events: [
          {
            event_id: "event-1",
            run_id: "run-2",
            task_id: "chat.workspace",
            seq: 0,
            created_at: timestamp,
            type: "artifact.final",
            artifact: {
              ...baseArtifact,
              run_id: "run-2",
              task_id: "chat.workspace",
              type: "chat_message",
              payload: {
                text: "Wrong run.",
              },
            },
          },
        ],
        artifacts: [
          {
            ...baseArtifact,
            task_id: "issue.enrichment",
            type: "chat_message",
            payload: {
              text: "Wrong task.",
            },
          },
        ],
      }),
    ).toThrow("event run_id must match envelope run_id");
  });
});
