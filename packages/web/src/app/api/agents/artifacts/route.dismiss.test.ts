// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DISMISS,
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

describe("agent artifact dismiss routes", () => {
  beforeEach(() => {
    resetArtifactRouteMocks();
  });

  it("defines the dismiss command contract", async () => {
    const res = await DISMISS(
      request({ artifact: chatArtifact, reason: "Not useful" }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: { status: "dismissed" },
    });
  });

  it("requires a vault when dismissing persisted activity artifacts", async () => {
    const res = await DISMISS(
      request({
        artifact: {
          ...chatArtifact,
          metadata: {
            persistence: {
              source_of_truth: "akb_activity_suggestion",
              activity_suggestion_id: null,
              retention: "akb_review_history",
            },
          },
        },
      }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "missing_vault" },
    });
    expect(mockUpdateActivitySuggestionStatus).not.toHaveBeenCalled();
  });

  it("uses the session actor when dismissing persisted artifacts", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: "reef-draft-1111111111111111",
        kind: "draft",
        status: "pending",
      },
    });

    const res = await DISMISS(
      request({
        artifact: {
          ...chatArtifact,
          metadata: { activity_suggestion_id: "reef-draft-1111111111111111" },
        },
        vault: "reef-test",
        actor: "spoofed-actor",
      }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateActivitySuggestionStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "reef-draft-1111111111111111",
        status: "dismissed",
        reviewed_by: "alice",
      }),
    );
  });

  it("rejects dismissing already-reviewed persisted artifacts", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: "reef-draft-1111111111111111",
        kind: "draft",
        status: "approved",
      },
    });

    const res = await DISMISS(
      request({
        artifact: {
          ...chatArtifact,
          metadata: { activity_suggestion_id: "reef-draft-1111111111111111" },
        },
        vault: "reef-test",
      }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "artifact_already_reviewed" },
    });
    expect(mockUpdateActivitySuggestionStatus).not.toHaveBeenCalled();
  });

  it("returns a typed 400 for malformed activity suggestion metadata", async () => {
    const res = await DISMISS(
      request({
        artifact: {
          ...chatArtifact,
          metadata: { activity_suggestion_id: "draft-1" },
        },
        vault: "reef-test",
      }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "invalid_activity_suggestion_id" },
    });
    expect(mockUpdateActivitySuggestionStatus).not.toHaveBeenCalled();
  });
});
