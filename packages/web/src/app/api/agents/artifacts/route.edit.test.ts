// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  PATCH,
  chatArtifact,
  mockReadIssue,
  mockUpdateIssue,
  paramsFor,
  request,
  resetArtifactRouteMocks,
} from "./route.testSupport";

describe("agent artifact edit routes", () => {
  beforeEach(() => resetArtifactRouteMocks());

  it("edits a client-ephemeral artifact without a vault", async () => {
    const res = await PATCH(
      request({ artifact: chatArtifact, patch: { title: "Updated" } }),
      { params: paramsFor("artifact-1") },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: {
        status: "edited",
        title: "Updated",
        metadata: {
          persistence: {
            source_of_truth: "client_ephemeral",
            retention: "browser_session",
          },
        },
      },
    });
    expect(mockReadIssue).not.toHaveBeenCalled();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });

  it("returns a typed 400 when an edit patch makes the artifact invalid", async () => {
    const res = await PATCH(
      request({ artifact: chatArtifact, patch: { title: "" } }),
      { params: paramsFor("artifact-1") },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      runtime_error: { code: "invalid_artifact_edit" },
    });
  });

  it("does not persist an edit even when a vault is supplied", async () => {
    const res = await PATCH(
      request({
        artifact: chatArtifact,
        vault: "reef-test",
        patch: { title: "Updated" },
      }),
      { params: paramsFor("artifact-1") },
    );
    expect(res.status).toBe(200);
    expect(mockReadIssue).not.toHaveBeenCalled();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });
});
