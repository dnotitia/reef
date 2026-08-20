// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  DISMISS,
  chatArtifact,
  mockReadIssue,
  mockUpdateIssue,
  paramsFor,
  request,
  resetArtifactRouteMocks,
} from "./route.testSupport";

describe("agent artifact dismiss routes", () => {
  beforeEach(() => resetArtifactRouteMocks());

  it("dismisses a client-ephemeral artifact without a vault", async () => {
    const res = await DISMISS(
      request({ artifact: chatArtifact, reason: "Not useful" }),
      { params: paramsFor("artifact-1") },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: {
        status: "dismissed",
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

  it("keeps dismissal client-ephemeral even when a vault is supplied", async () => {
    const res = await DISMISS(
      request({ artifact: chatArtifact, vault: "reef-test" }),
      { params: paramsFor("artifact-1") },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      artifact: { status: "dismissed" },
    });
    expect(mockReadIssue).not.toHaveBeenCalled();
    expect(mockUpdateIssue).not.toHaveBeenCalled();
  });
});
