import { describe, expect, it } from "vitest";
import {
  AgentArtifactPersistenceSchema,
  AgentArtifactSchema,
  AgentArtifactStatusEnum,
  AgentArtifactTypeEnum,
  AgentRunEnvelopeSchema,
  AgentRunEventSchema,
  AgentRunEventTypeEnum,
  AgentRunStatusEnum,
} from "./agents";
import { baseArtifact } from "./agents.testSupport";

describe("agent artifact schemas", () => {
  it("defines the run and artifact lifecycle enums", () => {
    expect(AgentRunStatusEnum.options).toEqual([
      "running",
      "completed",
      "empty",
      "error",
      "cancelled",
    ]);
    expect(AgentArtifactStatusEnum.options).toEqual([
      "pending",
      "edited",
      "approved",
      "dismissed",
    ]);
  });

  it("defines stable event and artifact taxonomies", () => {
    expect(AgentRunEventTypeEnum.options).toContain("stage.started");
    expect(AgentRunEventTypeEnum.options).toContain("tool.called");
    expect(AgentRunEventTypeEnum.options).toContain("model.delta");
    expect(AgentRunEventTypeEnum.options).toContain("repair.started");
    expect(AgentRunEventTypeEnum.options).toContain("artifact.final");
    expect(AgentRunEventTypeEnum.options).toContain("run.completed");

    expect(AgentArtifactTypeEnum.options).toEqual([
      "chat_message",
      "field_suggestion",
      "issue_create_proposal",
      "issue_update_proposal",
      "status_change_proposal",
    ]);
  });

  it("defines the artifact persistence boundary contract", () => {
    expect(
      AgentArtifactPersistenceSchema.parse({
        source_of_truth: "akb_activity_suggestion",
        activity_suggestion_id: "reef-draft-0123456789abcdef",
        retention: "akb_review_history",
      }),
    ).toMatchObject({
      source_of_truth: "akb_activity_suggestion",
      retention: "akb_review_history",
    });

    expect(
      AgentArtifactPersistenceSchema.safeParse({
        source_of_truth: "akb_activity_suggestion",
        activity_suggestion_id: "draft-1",
        retention: "akb_review_history",
      }).success,
    ).toBe(false);
  });

  it("parses chat, enrichment, issue proposal, and status proposal artifacts", () => {
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
        },
      },
      {
        ...baseArtifact,
        artifact_id: "artifact-3",
        type: "issue_create_proposal",
        task_id: "activity.draft",
        payload: {
          proposal: {
            operation: "create",
            create: {
              fields: { title: "Add runtime collector", priority: "medium" },
              content: "## Problem",
            },
          },
        },
      },
      {
        ...baseArtifact,
        artifact_id: "artifact-4",
        type: "status_change_proposal",
        task_id: "activity.status-change",
        payload: {
          proposal: {
            operation: "update",
            update: {
              issue_id: "REEF-036",
              patch: { status: "in_review" },
            },
          },
          from_status: "in_progress",
          to_status: "in_review",
          rationale: "Acceptance criteria are satisfied.",
          evidence: [
            {
              type: "url",
              url: "https://github.com/tobi/reef/pull/1",
            },
          ],
          status_evidence: [
            { type: "pr", ref: "123", repo: "tobi/reef", actor: "alice" },
          ],
        },
      },
    ];

    expect(
      artifacts.map((artifact) => AgentArtifactSchema.parse(artifact)),
    ).toHaveLength(4);
  });

  it("rejects close-only metadata on non-status update proposals", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        type: "issue_update_proposal",
        task_id: "activity.draft",
        payload: {
          proposal: {
            operation: "update",
            update: {
              issue_id: "REEF-036",
              patch: { closed_reason: "completed" },
            },
          },
        },
      }),
    ).toThrow();
  });

  it("rejects a status artifact whose proposal status disagrees with to_status", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        type: "status_change_proposal",
        payload: {
          proposal: {
            operation: "update",
            update: {
              issue_id: "REEF-036",
              patch: { status: "done" },
            },
          },
          from_status: "in_progress",
          to_status: "in_review",
          rationale: "Mismatch should fail.",
          status_evidence: [
            { type: "pr", ref: "123", repo: "tobi/reef", actor: "alice" },
          ],
        },
      }),
    ).toThrow("proposal.update.patch.status must match to_status");
  });

  it("rejects unsafe artifact evidence URLs and ungrounded status changes", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        type: "chat_message",
        evidence: [{ type: "url", url: "javascript:alert(1)" }],
        payload: {
          text: "Unsafe link should fail.",
        },
      }),
    ).toThrow("url must use http or https");

    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        type: "status_change_proposal",
        payload: {
          proposal: {
            operation: "update",
            update: {
              issue_id: "REEF-036",
              patch: { status: "in_review" },
            },
          },
          from_status: "in_progress",
          to_status: "in_review",
          rationale: "Evidence is required.",
          status_evidence: [],
        },
      }),
    ).toThrow("Array must contain at least 1 element");
  });

  it("forces status changes through status-change artifacts only", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        type: "issue_update_proposal",
        payload: {
          proposal: {
            operation: "update",
            update: {
              issue_id: "REEF-036",
              patch: { status: "done" },
            },
          },
        },
      }),
    ).toThrow("Unrecognized key(s) in object: 'status'");
  });

  it("rejects non-status edits inside status-change artifacts", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        type: "status_change_proposal",
        payload: {
          proposal: {
            operation: "update",
            update: {
              issue_id: "REEF-036",
              patch: { status: "in_review", title: "Hidden title edit" },
            },
          },
          from_status: "in_progress",
          to_status: "in_review",
          rationale: "Only status can move here.",
          status_evidence: [
            { type: "pr", ref: "123", repo: "tobi/reef", actor: "alice" },
          ],
        },
      }),
    ).toThrow("Unrecognized key(s) in object: 'title'");
  });

  it("rejects empty status-change evidence fields", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        type: "status_change_proposal",
        payload: {
          proposal: {
            operation: "update",
            update: {
              issue_id: "REEF-036",
              patch: { status: "in_review" },
            },
          },
          from_status: "in_progress",
          to_status: "in_review",
          rationale: "Empty provenance should fail.",
          status_evidence: [{ type: "pr", ref: "", repo: "", actor: "" }],
        },
      }),
    ).toThrow("String must contain at least 1 character");
  });

  it("rejects malformed runtime timestamps at schema boundaries", () => {
    expect(() =>
      AgentArtifactSchema.parse({
        ...baseArtifact,
        created_at: "not-a-date",
        type: "chat_message",
        payload: {
          text: "Malformed timestamp should fail.",
        },
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

    expect(() =>
      AgentRunEnvelopeSchema.parse({
        run_id: "run-1",
        task_id: "chat.workspace",
        status: "running",
        started_at: "tomorrow",
      }),
    ).toThrow("must be a valid ISO 8601 date string");
  });
});
