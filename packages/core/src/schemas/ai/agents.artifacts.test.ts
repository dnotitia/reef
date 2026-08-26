import { describe, expect, it } from "vitest";
import {
  AgentArtifactSchema,
  AgentArtifactTypeEnum,
  AgentRunEventSchema,
} from "./agents";
import { baseArtifact } from "./agents.testSupport";

describe("agent artifact schemas", () => {
  it("keeps only artifacts emitted by the live chat and enrichment flows", () => {
    expect(AgentArtifactTypeEnum.options).toEqual([
      "chat_message",
      "field_suggestion",
    ]);
  });

  it("parses chat and field-suggestion artifacts", () => {
    const artifacts = [
      {
        ...baseArtifact,
        type: "chat_message",
        task_id: "chat.workspace",
        payload: {
          role: "assistant",
          text: "REEF-036 is ready.",
        },
      },
      {
        ...baseArtifact,
        artifact_id: "artifact-2",
        type: "field_suggestion",
        payload: {
          issue_id: "REEF-036",
          suggestions: [
            {
              field: "priority",
              value: "high",
              reasoning: "It blocks the runtime contract.",
              confidence: 0.82,
            },
          ],
          references: [
            {
              uri: "akb://reef/doc/design.md",
              title: "Design notes",
              reasoning: "Relevant design context.",
              confidence: 0.76,
            },
          ],
        },
      },
    ];

    expect(
      artifacts.map((artifact) => AgentArtifactSchema.parse(artifact)),
    ).toHaveLength(2);
  });

  it("rejects malformed runtime timestamps", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        created_at: "not-a-date",
        type: "chat_message",
        payload: { text: "Malformed timestamp should fail." },
      }),
    ).toThrow("must be a valid ISO 8601 date string");

    expect(() =>
      AgentRunEventSchema.parse({
        event_id: "event-1",
        run_id: "run-1",
        task_id: "chat.workspace",
        seq: 0,
        created_at: "later",
        type: "run.started",
        run_status: "running",
      }),
    ).toThrow("must be a valid ISO 8601 date string");
  });
});
