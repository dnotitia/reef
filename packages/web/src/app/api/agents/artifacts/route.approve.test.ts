// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPROVE,
  chatArtifact,
  createIssueArtifact,
  mockAllocateNextIssueId,
  mockBuildIssueMetadataFromCreateInput,
  mockGetAkbAdapter,
  mockGetAkbCurrentActor,
  mockListIssues,
  mockReadActivitySuggestion,
  mockReadIssue,
  mockRespondWithError,
  mockUpdateActivitySuggestion,
  mockUpdateActivitySuggestionStatus,
  mockUpdateIssue,
  mockWriteIssue,
  paramsFor,
  request,
  resetArtifactRouteMocks,
  statusChangeArtifact,
  updateIssueArtifact,
} from "./route.testSupport";

describe("agent artifact approve routes", () => {
  beforeEach(() => {
    resetArtifactRouteMocks();
  });

  it("approves issue-create artifacts through the existing create flow", async () => {
    const res = await APPROVE(
      request({
        artifact: createIssueArtifact,
        vault: "reef-test",
        prefix: "REEF",
        actor: "spoofed-actor",
      }),
      { params: paramsFor("artifact-create") },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: {
        status: "approved",
        metadata: { source: "ai-agent:artifact:artifact-create" },
      },
      issueId: "REEF-099",
    });
    expect(mockAllocateNextIssueId).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "reef-test", prefix: "REEF" }),
    );
    expect(mockBuildIssueMetadataFromCreateInput).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "REEF-099",
        source: "ai-agent:artifact:artifact-create",
        author: "alice",
      }),
    );
    expect(mockWriteIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-test",
        content: "Implement the unified route.",
      }),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it("rejects malformed project prefixes before allocation", async () => {
    const res = await APPROVE(
      request({
        artifact: createIssueArtifact,
        vault: "reef-test",
        prefix: "reef-1",
      }),
      { params: paramsFor("artifact-create") },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "invalid_artifact_command_request" },
    });
    expect(mockAllocateNextIssueId).not.toHaveBeenCalled();
    expect(mockWriteIssue).not.toHaveBeenCalled();
  });

  it("blocks persisted-backed activity artifacts until their suggestion row exists", async () => {
    const res = await APPROVE(
      request({
        artifact: {
          ...createIssueArtifact,
          metadata: {
            persistence: {
              source_of_truth: "akb_activity_suggestion",
              activity_suggestion_id: null,
              retention: "akb_review_history",
            },
            provenance: {
              type: "commit",
              ref: "abc123",
              repo: "octo/cat",
              actor: "alice",
              detectedAt: "2026-06-04T00:00:00.000Z",
            },
          },
        },
        vault: "reef-test",
        prefix: "REEF",
      }),
      { params: paramsFor("artifact-create") },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "activity_suggestion_persisting" },
    });
    expect(mockWriteIssue).not.toHaveBeenCalled();
    expect(mockUpdateActivitySuggestionStatus).not.toHaveBeenCalled();
  });

  it("approves issue-update artifacts through the existing update flow", async () => {
    const res = await APPROVE(
      request({
        artifact: updateIssueArtifact,
        vault: "reef-test",
        actor: "spoofed-actor",
      }),
      { params: paramsFor("artifact-update") },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: {
        status: "approved",
        metadata: { source: "ai-agent:artifact:artifact-update" },
      },
      issueId: "REEF-043",
      commit_hash: "def456",
    });
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        vault: "reef-test",
        id: "REEF-043",
        content: "Updated body",
        partial: expect.objectContaining({
          title: "Updated unified route",
          updated_by: "alice",
          source: "ai-agent:artifact:artifact-update",
        }),
      }),
    );
  });

  it("preserves status-change side effects when approving status artifacts", async () => {
    mockReadIssue.mockResolvedValueOnce({
      issue: { id: "REEF-043", status: "in_progress", source: "manual" },
      content: "Issue body",
    });

    const res = await APPROVE(
      request({
        artifact: statusChangeArtifact,
        vault: "reef-test",
        actor: "spoofed-actor",
      }),
      { params: paramsFor("artifact-status") },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "REEF-043",
        partial: expect.objectContaining({
          status: "in_review",
          source: "ai-agent:artifact:artifact-status",
          updated_by: "alice",
          last_status_change: expect.any(String),
          closed_at: null,
          closed_reason: null,
        }),
      }),
    );
  });

  it("rejects approval when the body artifact id does not match the path", async () => {
    const res = await APPROVE(
      request({
        artifact: { ...createIssueArtifact, artifact_id: "other-artifact" },
        vault: "reef-test",
        prefix: "REEF",
      }),
      { params: paramsFor("artifact-create") },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "artifact_id_mismatch" },
    });
    expect(mockWriteIssue).not.toHaveBeenCalled();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });
});
