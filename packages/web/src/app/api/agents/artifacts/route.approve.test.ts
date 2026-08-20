// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  APPROVE,
  createIssueArtifact,
  mockAllocateNextIssueId,
  mockBuildIssueMetadataFromCreateInput,
  mockListIssues,
  mockReadIssue,
  mockUpdateIssue,
  mockWriteIssue,
  paramsFor,
  request,
  resetArtifactRouteMocks,
  statusChangeArtifact,
  updateIssueArtifact,
} from "./route.testSupport";

describe("agent artifact approve routes", () => {
  beforeEach(() => resetArtifactRouteMocks());

  it("approves issue-create artifacts through the existing create flow", async () => {
    const res = await APPROVE(
      request({
        artifact: createIssueArtifact,
        vault: "reef-test",
        prefix: "REEF",
      }),
      { params: paramsFor("artifact-create") },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: {
        status: "approved",
        metadata: {
          source: "ai-agent:artifact:artifact-create",
          persistence: { source_of_truth: "client_ephemeral" },
        },
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
      expect.objectContaining({ vault: "reef-test" }),
    );
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
  });

  it("approves issue-update artifacts through the existing update flow", async () => {
    const res = await APPROVE(
      request({ artifact: updateIssueArtifact, vault: "reef-test" }),
      { params: paramsFor("artifact-update") },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: { status: "approved" },
      issueId: "REEF-043",
      commit_hash: "def456",
    });
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "REEF-043", vault: "reef-test" }),
    );
  });

  it("approves forward status-change artifacts", async () => {
    mockReadIssue.mockResolvedValueOnce({
      issue: { id: "REEF-043", status: "in_progress", source: "manual" },
      content: "Issue body",
    });
    const res = await APPROVE(
      request({ artifact: statusChangeArtifact, vault: "reef-test" }),
      { params: paramsFor("artifact-status") },
    );

    expect(res.status).toBe(200);
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "REEF-043",
        partial: expect.objectContaining({
          status: "in_review",
          source: "ai-agent:artifact:artifact-status",
        }),
      }),
    );
  });

  it("reuses an issue created by the same artifact without writing twice", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: [{ id: "REEF-099", source: "ai-agent:artifact:artifact-create" }],
    });
    const res = await APPROVE(
      request({
        artifact: createIssueArtifact,
        vault: "reef-test",
        prefix: "REEF",
      }),
      { params: paramsFor("artifact-create") },
    );
    expect(res.status).toBe(200);
    expect(mockWriteIssue).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ issueId: "REEF-099" });
  });
});
