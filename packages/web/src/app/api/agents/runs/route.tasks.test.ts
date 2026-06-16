// @vitest-environment node
import type { AgentRunEvent } from "@reef/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POST,
  activityRunBody,
  chatRunBody,
  childArtifactFinal,
  cleanupAgentRunsRouteMocks,
  enrichmentRunBody,
  issueDraftFields,
  makeRequest,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  mockListActivitySuggestions,
  mockScanActivity,
  mockWriteActivitySuggestion,
  parseSseEvents,
  resetAgentRunsRouteMocks,
  runCompleted,
  runError,
  runStarted,
} from "./route.testSupport";

describe("POST /api/agents/runs task execution", () => {
  beforeEach(() => {
    resetAgentRunsRouteMocks();
  });

  afterEach(() => {
    cleanupAgentRunsRouteMocks();
  });

  it("streams issue.enrichment through the unified route", async () => {
    const res = await POST(makeRequest(enrichmentRunBody));

    expect(res.status).toBe(200);
    expect(
      parseSseEvents(await res.text()).map((event) => event.task_id),
    ).toEqual(["issue.enrichment", "issue.enrichment"]);
    expect(mockEnrichIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ issueId: "REEF-043" }),
        onEvent: expect.any(Function),
      }),
    );
  });

  it("streams activity.scan through the unified route", async () => {
    const res = await POST(makeRequest(activityRunBody));

    expect(res.status).toBe(200);
    expect(parseSseEvents(await res.text()).map((event) => event.type)).toEqual(
      ["run.started", "run.empty"],
    );
    expect(mockScanActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "reef",
        vault: "reef-test",
        dismissedRefs: [],
        onEvent: expect.any(Function),
      }),
    );
    expect(mockWriteActivitySuggestion).not.toHaveBeenCalled();
  });

  it("persists activity artifacts as AKB suggestions before run completion", async () => {
    mockScanActivity.mockImplementationOnce(
      async (params: {
        onEvent?: (event: AgentRunEvent) => Promise<void> | void;
      }) => {
        await params.onEvent?.(runStarted("activity.draft"));
        await params.onEvent?.(childArtifactFinal());
        await params.onEvent?.(runCompleted("activity.draft"));
        return {
          drafts: [
            {
              id: "0312a7f3-0a28-4f35-9be0-c3c7cb9b3b4d",
              proposal: {
                operation: "create",
                create: {
                  fields: issueDraftFields,
                  content: "Implement the unified route.",
                },
              },
              provenance: {
                type: "commit",
                ref: "abc123",
                repo: "acme/reef",
                actor: "alice",
                detectedAt: "2026-06-04T00:00:00.000Z",
              },
              confidence: 0.8,
              reasoning: "Commit introduced new work.",
              status: "pending",
              createdAt: "2026-06-04T00:00:00.000Z",
            },
          ],
          statusChanges: [],
        };
      },
    );

    const res = await POST(makeRequest(activityRunBody));
    const events = parseSseEvents(await res.text());
    const topLevelRunId = events[0]?.run_id;
    const artifactEvent = events.find(
      (event): event is Extract<AgentRunEvent, { type: "artifact.final" }> =>
        event.type === "artifact.final",
    );
    const completedEvent = events.find(
      (event): event is Extract<AgentRunEvent, { type: "run.completed" }> =>
        event.type === "run.completed",
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "artifact.final",
      "run.completed",
    ]);
    expect(events.every((event) => event.task_id === "activity.scan")).toBe(
      true,
    );
    expect(events.every((event) => event.run_id === topLevelRunId)).toBe(true);
    expect(artifactEvent?.artifact.run_id).toBe(topLevelRunId);
    expect(artifactEvent?.artifact.task_id).toBe("activity.scan");
    expect(artifactEvent?.metadata).toMatchObject({
      nested_run_id: "activity.draft:run",
      nested_task_id: "activity.draft",
    });
    expect(completedEvent?.artifact_ids).toEqual(["artifact-draft-1"]);
    expect(completedEvent?.usage).toMatchObject({
      draft_count: 1,
      status_change_count: 0,
      persisted_suggestion_count: 1,
    });
    expect(mockWriteActivitySuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-test",
        suggestion: expect.objectContaining({
          kind: "draft",
          status: "pending",
          proposal: expect.objectContaining({ operation: "create" }),
        }),
      }),
    );
  });

  it("does not persist activity artifacts after the run is aborted", async () => {
    const controller = new AbortController();
    mockScanActivity.mockImplementationOnce(async () => {
      controller.abort();
      return {
        drafts: [
          {
            id: "0312a7f3-0a28-4f35-9be0-c3c7cb9b3b4d",
            proposal: {
              operation: "create",
              create: {
                fields: issueDraftFields,
                content: "Implement the unified route.",
              },
            },
            provenance: {
              type: "commit",
              ref: "abc123",
              repo: "acme/reef",
              actor: "alice",
              detectedAt: "2026-06-04T00:00:00.000Z",
            },
            confidence: 0.8,
            reasoning: "Commit introduced new work.",
            status: "pending",
            createdAt: "2026-06-04T00:00:00.000Z",
          },
        ],
        statusChanges: [],
      };
    });

    const res = await POST(
      makeRequest(activityRunBody, {}, { signal: controller.signal }),
    );
    await res.text();

    expect(mockScanActivity).toHaveBeenCalled();
    expect(mockWriteActivitySuggestion).not.toHaveBeenCalled();
  });
});
