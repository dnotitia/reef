import { describe, expect, it, vi } from "vitest";
import { SchemaValidationError } from "../../../errors";
import {
  copyFileToDocumentAsset,
  discardDocumentAsset,
  getDocumentAssetMetadata,
  getDocumentAssetPolicy,
  readDocumentAsset,
  uploadDocumentAsset,
} from "./documentAssets";
import type { AkbAdapter } from "../core/http";

const ASSET_ID = "00000000-0000-4000-8000-000000000001";

function makeAdapter(response: unknown): {
  adapter: AkbAdapter;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn().mockResolvedValue(response);
  return { adapter: { request }, request };
}

describe("document asset adapter", () => {
  it("uploads image bytes through the authenticated AKB asset endpoint", async () => {
    const response = {
      kind: "attachment",
      id: ASSET_ID,
      target: `/api/assets/${ASSET_ID}`,
      name: "diagram.png",
      mime_type: "image/png",
      size_bytes: 3,
      unclaimed_expires_at: "2026-09-11T00:00:00.000Z",
    };
    const { adapter, request } = makeAdapter(response);

    await expect(
      uploadDocumentAsset({
        adapter,
        vault: "reef-test",
        filename: "diagram.png",
        mimeType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toEqual(response);

    expect(request).toHaveBeenCalledWith(
      "/api/v1/assets/reef-test",
      expect.objectContaining({
        method: "POST",
        query: { filename: "diagram.png" },
        rawHeaders: { "Content-Type": "image/png" },
        resource: "document asset diagram.png",
      }),
    );
    const body = request.mock.calls[0]?.[1]?.rawBody;
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(body as ArrayBuffer)]).toEqual([1, 2, 3]);
  });

  it("reads metadata, bytes, policy, copies files, and discards unclaimed assets", async () => {
    const binary = {
      body: new Uint8Array([4, 5]).buffer,
      contentType: "image/png",
      contentLength: 2,
      filename: "diagram.png",
    };
    const { adapter, request } = makeAdapter(binary);

    await expect(
      readDocumentAsset({ adapter, vault: "reef-test", assetId: ASSET_ID }),
    ).resolves.toEqual(binary);

    request.mockResolvedValueOnce({
      kind: "attachment",
      target: `/api/assets/${ASSET_ID}`,
      status: "unclaimed",
      unclaimed_expires_at: "2026-09-11T00:00:00.000Z",
    });
    await expect(
      getDocumentAssetMetadata({
        adapter,
        vault: "reef-test",
        assetId: ASSET_ID,
        document: "issues/reef-001.md",
        commit: "abcdef1234567",
      }),
    ).resolves.toMatchObject({ status: "unclaimed" });

    request.mockResolvedValueOnce({ discarded: true });
    await expect(
      discardDocumentAsset(adapter, "reef-test", ASSET_ID),
    ).resolves.toEqual({ discarded: true });

    request.mockResolvedValueOnce({
      kind: "attachment",
      id: ASSET_ID,
      target: `/api/assets/${ASSET_ID}`,
      name: "copied.png",
      mime_type: "image/png",
      size_bytes: 2,
    });
    await expect(
      copyFileToDocumentAsset(adapter, "reef-test", "file-1"),
    ).resolves.toMatchObject({ id: ASSET_ID });

    request.mockResolvedValueOnce({
      kind: "attachment_policy",
      vault: "reef-test",
      server_time: "2026-09-10T00:00:00.000Z",
      unclaimed_ttl_hours: 24,
      revision_retention_days: 30,
    });
    await expect(
      getDocumentAssetPolicy(adapter, "reef-test"),
    ).resolves.toMatchObject({ unclaimed_ttl_hours: 24 });

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      `/api/assets/${ASSET_ID}`,
      `/api/v1/assets/reef-test/${ASSET_ID}/metadata`,
      `/api/v1/assets/reef-test/${ASSET_ID}`,
      "/api/v1/assets/reef-test/from-file/file-1",
      "/api/v1/assets/reef-test/policy",
    ]);
  });

  it("rejects a non-UUID asset before making an upstream request", async () => {
    const { adapter, request } = makeAdapter(null);

    await expect(
      readDocumentAsset({ adapter, vault: "reef-test", assetId: "not-an-id" }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(request).not.toHaveBeenCalled();
  });
});
