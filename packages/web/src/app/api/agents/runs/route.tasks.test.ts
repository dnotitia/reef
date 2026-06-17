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
  mockScanAndPersistActivitySuggestions,
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
    expect(mockScanAndPersistActivitySuggestions).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "reef",
        vault: "reef-test",
        onEvent: expect.any(Function),
        isAborted: expect.any(Function),
      }),
    );
  });

  it("streams activity artifacts before run completion", async () => {
    mockScanAndPersistActivitySuggestions.mockImplementationOnce(
      async (params: {
        onEvent?: (event: AgentRunEvent) => Promise<void> | void;
      }) => {
        await params.onEvent?.(runStarted("activity.draft"));
        await params.onEvent?.(childArtifactFinal());
        await params.onEvent?.(runCompleted("activity.draft"));
        return {
          status: "completed",
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
          persistedSuggestions: [
            {
              id: "reef-draft-0123456789abcdef",
              kind: "draft",
              status: "pending",
              fingerprint: "acme/reef:commit:abc123",
              repo: "acme/reef",
              created_at: "2026-06-04T00:00:00.000Z",
              detected_at: "2026-06-04T00:00:00.000Z",
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
            },
          ],
          addedDrafts: 1,
          addedStatusChanges: 0,
          scannedAt: "2026-06-04T00:00:01.000Z",
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
  });

  it("emits a cancelled terminal event after the run is aborted", async () => {
    mockScanAndPersistActivitySuggestions.mockImplementationOnce(async () => {
      return {
        status: "aborted",
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
        persistedSuggestions: [],
        addedDrafts: 0,
        addedStatusChanges: 0,
        scannedAt: "2026-06-04T00:00:01.000Z",
      };
    });

    const res = await POST(makeRequest(activityRunBody));
    const events = parseSseEvents(await res.text());

    expect(mockScanAndPersistActivitySuggestions).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.cancelled",
    ]);
  });
});
