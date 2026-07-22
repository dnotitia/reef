// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ConflictError, SchemaLifecycleError } from "../../../errors";
import {
  REEF_INITIALIZATION_MARKER_PATH,
  advanceWorkspaceInitializationMarker,
  createWorkspaceInitializationMarker,
} from "./initializationMarker";

const fingerprint = "a".repeat(64);

function document(state: string, commit: string) {
  return {
    uri: "akb://reef-sample/coll/overview/doc/reef-initialization.md",
    vault: "reef-sample",
    path: REEF_INITIALIZATION_MARKER_PATH,
    title: "Reef workspace initialization",
    type: "reference",
    status: "active",
    current_commit: commit,
    content: JSON.stringify({
      schema_version: 1,
      state,
      request_fingerprint: fingerprint,
    }),
  };
}

describe("workspace initialization marker", () => {
  it("uses the canonical create-response URI after durable readback", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        uri: document("initializing", "c1").uri,
        vault: "reef-sample",
        path: REEF_INITIALIZATION_MARKER_PATH,
        commit_hash: "c1",
      })
      .mockResolvedValueOnce(document("initializing", "c1"));

    const result = await createWorkspaceInitializationMarker(
      { request },
      "reef-sample",
      fingerprint,
    );

    expect(result.uri).toBe(document("initializing", "c1").uri);
    expect(request.mock.calls[0]?.[1]?.body).toMatchObject({
      collection: "overview",
      slug: "reef-initialization",
    });
  });

  it("converges after a create conflict by reading the winning marker", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ConflictError())
      .mockResolvedValueOnce(document("initializing", "winner"));

    await expect(
      createWorkspaceInitializationMarker(
        { request },
        "reef-sample",
        fingerprint,
      ),
    ).resolves.toMatchObject({ currentCommit: "winner" });
  });

  it("uses expected_commit and accepts response-loss readback at or beyond the target", async () => {
    const current = {
      uri: document("writer_registered", "c1").uri,
      path: REEF_INITIALIZATION_MARKER_PATH,
      currentCommit: "c1",
      marker: {
        schema_version: 1,
        state: "writer_registered" as const,
        request_fingerprint: fingerprint,
      },
    };
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(document("schema_provisioned", "c2"));

    await expect(
      advanceWorkspaceInitializationMarker(
        { request },
        "reef-sample",
        current,
        "schema_provisioned",
      ),
    ).resolves.toMatchObject({
      currentCommit: "c2",
      marker: { state: "schema_provisioned" },
    });
    expect(request.mock.calls[0]?.[1]?.body).toMatchObject({
      expected_commit: "c1",
    });
  });

  it("rejects state skipping before any write", async () => {
    const request = vi.fn();
    await expect(
      advanceWorkspaceInitializationMarker(
        { request },
        "reef-sample",
        {
          uri: document("initializing", "c1").uri,
          path: REEF_INITIALIZATION_MARKER_PATH,
          currentCommit: "c1",
          marker: {
            schema_version: 1,
            state: "initializing",
            request_fingerprint: fingerprint,
          },
        },
        "schema_provisioned",
      ),
    ).rejects.toBeInstanceOf(SchemaLifecycleError);
    expect(request).not.toHaveBeenCalled();
  });
});
