import { describe, expect, it } from "vitest";
import {
  AgentRunRequestSchema,
  WorkspaceChatAgentInputSchema,
  WorkspaceChatRequestBodySchema,
} from "./agentRun";

const issueDraftFields = {
  title: "Fix login bug",
  issue_type: "bug",
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

describe("agent run request schemas", () => {
  it("validates workspace chat task input", () => {
    expect(
      AgentRunRequestSchema.parse({
        task_id: "chat.workspace",
        input: {
          messages: [
            {
              id: "m-1",
              role: "user",
              parts: [{ type: "text", text: "Show project status" }],
            },
          ],
        },
      }),
    ).toMatchObject({
      task_id: "chat.workspace",
      input: { messages: expect.any(Array) },
    });
  });

  it("validates issue enrichment task input", () => {
    expect(
      AgentRunRequestSchema.parse({
        task_id: "issue.enrichment",
        input: {
          issueId: "REEF-043",
          vault: "reef-test",
          draft: {
            fields: issueDraftFields,
            content: "Users cannot log in after token expiry.",
          },
          repoContext: { owner: "acme", repo: "reef" },
        },
      }),
    ).toMatchObject({
      task_id: "issue.enrichment",
      input: { issueId: "REEF-043" },
    });
  });

  it("rejects malformed issue enrichment vault ids", () => {
    expect(() =>
      AgentRunRequestSchema.parse({
        task_id: "issue.enrichment",
        input: {
          issueId: "REEF-043",
          vault: "../reef-test",
          draft: {
            fields: issueDraftFields,
            content: "Users cannot log in after token expiry.",
          },
        },
      }),
    ).toThrow();
  });

  it("rejects the removed activity scan task", () => {
    expect(() =>
      AgentRunRequestSchema.parse({ task_id: "activity.scan", input: {} }),
    ).toThrow();
  });

  it("rejects unknown task ids", () => {
    expect(() =>
      AgentRunRequestSchema.parse({
        task_id: "unknown.task",
        input: {},
      }),
    ).toThrow();
  });

  it("keeps chat message validation strict for text parts", () => {
    expect(
      WorkspaceChatAgentInputSchema.safeParse({
        messages: [{ id: "m-1", role: "user", parts: [{ type: "text" }] }],
      }).success,
    ).toBe(false);
  });

  it("requires chat message ids for AI SDK UIMessage compat", () => {
    expect(
      WorkspaceChatAgentInputSchema.safeParse({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Show project status" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("normalizes older chat request messages without ids", () => {
    expect(
      WorkspaceChatRequestBodySchema.parse({
        messages: [
          {
            role: "user",
            parts: [{ type: "text", text: "Show project status" }],
          },
        ],
      }).messages[0]?.id,
    ).toBe("chat-message-0");
  });

  it("allows AI SDK transport metadata around chat messages", () => {
    expect(
      WorkspaceChatAgentInputSchema.safeParse({
        id: "chat-1",
        trigger: "submit-message",
        messageId: "message-1",
        messages: [
          {
            id: "m-1",
            role: "user",
            metadata: { traceId: "trace-1" },
            parts: [{ type: "text", text: "Show project status" }],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("allows AI SDK text part state and provider metadata", () => {
    expect(
      WorkspaceChatAgentInputSchema.safeParse({
        messages: [
          {
            id: "m-2",
            role: "assistant",
            parts: [
              {
                type: "text",
                text: "Project status is green.",
                state: "done",
                providerMetadata: { openai: { cachedTokens: 12 } },
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
});
