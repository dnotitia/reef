// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCH,
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

describe("agent artifact edit routes", () => {
  beforeEach(() => {
    resetArtifactRouteMocks();
  });

  it("defines the edit command contract", async () => {
    const res = await PATCH(
      request({ artifact: chatArtifact, patch: { title: "Updated" } }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: { status: "edited", title: "Updated" },
    });
  });

  it("returns a typed 400 when an edit patch makes the artifact invalid", async () => {
    const res = await PATCH(
      request({ artifact: chatArtifact, patch: { title: "" } }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "invalid_artifact_edit" },
    });
  });

  it("requires a vault when editing persisted activity artifacts", async () => {
    const res = await PATCH(
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
        patch: { title: "Updated" },
      }),
      {
        params: paramsFor("artifact-1"),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "missing_vault" },
    });
  });

  it("rejects persisted status-change edits that retarget another issue", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: "reef-status-1111111111111111",
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-043",
            patch: { status: "in_review" },
          },
        },
      },
    });

    const res = await PATCH(
      request({
        artifact: {
          ...statusChangeArtifact,
          metadata: {
            activity_suggestion_id: "reef-status-1111111111111111",
          },
        },
        vault: "reef-test",
        patch: {
          payload: {
            ...statusChangeArtifact.payload,
            proposal: {
              operation: "update",
              update: {
                issue_id: "REEF-999",
                patch: { status: "done" },
              },
            },
            to_status: "done",
          },
        },
      }),
      {
        params: paramsFor("artifact-status"),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "status_change_retarget_forbidden" },
    });
    expect(mockUpdateActivitySuggestion).not.toHaveBeenCalled();
  });

  it("rejects persisted status-change edits that target closed", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: "reef-status-1111111111111111",
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-043",
            patch: { status: "in_review" },
          },
        },
      },
    });

    const res = await PATCH(
      request({
        artifact: {
          ...statusChangeArtifact,
          metadata: {
            activity_suggestion_id: "reef-status-1111111111111111",
          },
        },
        vault: "reef-test",
        patch: {
          payload: {
            ...statusChangeArtifact.payload,
            proposal: {
              operation: "update",
              update: {
                issue_id: "REEF-043",
                patch: { status: "closed" },
              },
            },
            to_status: "closed",
          },
        },
      }),
      {
        params: paramsFor("artifact-status"),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "close_requires_reason" },
    });
    expect(mockUpdateActivitySuggestion).not.toHaveBeenCalled();
  });

  it("rejects persisted status-change edits that target backlog (REEF-109)", async () => {
    // backlog is rank 0; approval's forward-moving guard could does not accept it, so
    // the edit boundary should reject it rather than persist an unapprovable row.
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: "reef-status-1111111111111111",
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-043",
            patch: { status: "in_review" },
          },
        },
      },
    });

    const res = await PATCH(
      request({
        artifact: {
          ...statusChangeArtifact,
          metadata: {
            activity_suggestion_id: "reef-status-1111111111111111",
          },
        },
        vault: "reef-test",
        patch: {
          payload: {
            ...statusChangeArtifact.payload,
            proposal: {
              operation: "update",
              update: {
                issue_id: "REEF-043",
                patch: { status: "backlog" },
              },
            },
            to_status: "backlog",
          },
        },
      }),
      {
        params: paramsFor("artifact-status"),
      },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "invalid_status_change_target" },
    });
    expect(mockUpdateActivitySuggestion).not.toHaveBeenCalled();
  });

  it("edits persisted status-change artifacts through the original suggestion row", async () => {
    mockReadActivitySuggestion.mockResolvedValueOnce({
      suggestion: {
        id: "reef-status-1111111111111111",
        kind: "status_change",
        status: "pending",
        proposal: {
          operation: "update",
          update: {
            issue_id: "REEF-043",
            patch: { status: "in_review" },
          },
        },
      },
    });

    const res = await PATCH(
      request({
        artifact: {
          ...statusChangeArtifact,
          metadata: {
            persistence: {
              source_of_truth: "akb_activity_suggestion",
              activity_suggestion_id: null,
              retention: "akb_review_history",
            },
          },
        },
        vault: "reef-test",
        patch: {
          payload: {
            ...statusChangeArtifact.payload,
            proposal: {
              operation: "update",
              update: {
                issue_id: "REEF-043",
                patch: { status: "done" },
              },
            },
            to_status: "done",
            rationale: "The implementation has landed.",
          },
        },
      }),
      {
        params: paramsFor("artifact-status"),
      },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateActivitySuggestion).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          update: {
            issue_id: "REEF-043",
            patch: { status: "done" },
          },
          rationale: "The implementation has landed.",
        },
      }),
    );
  });
});
