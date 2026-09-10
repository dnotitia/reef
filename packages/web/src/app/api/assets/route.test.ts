// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/telemetry", () => ({
  tracer: {
    startActiveSpan: vi.fn(
      async (
        _name: string,
        fn: (span: {
          setAttribute: () => void;
          recordException: () => void;
          setStatus: () => void;
          end: () => void;
        }) => Promise<unknown>,
      ) =>
        fn({
          setAttribute: () => {},
          recordException: () => {},
          setStatus: () => {},
          end: () => {},
        }),
    ),
  },
}));

const {
  mockUploadAsset,
  mockReadAsset,
  mockMetadata,
  mockDiscardAsset,
  mockCopyAsset,
  mockPolicy,
  mockCreateAdapter,
} = vi.hoisted(() => ({
  mockUploadAsset: vi.fn(),
  mockReadAsset: vi.fn(),
  mockMetadata: vi.fn(),
  mockDiscardAsset: vi.fn(),
  mockCopyAsset: vi.fn(),
  mockPolicy: vi.fn(),
  mockCreateAdapter: vi.fn(),
}));

vi.mock("@reef/core", async () => {
  const actual =
    await vi.importActual<typeof import("@reef/core")>("@reef/core");
  return {
    ...actual,
    akbUploadDocumentAsset: mockUploadAsset,
    akbReadDocumentAsset: mockReadAsset,
    akbGetDocumentAssetMetadata: mockMetadata,
    akbDiscardDocumentAsset: mockDiscardAsset,
    akbCopyFileToDocumentAsset: mockCopyAsset,
    akbGetDocumentAssetPolicy: mockPolicy,
    createAkbAdapter: mockCreateAdapter,
  };
});

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { VALID_JWT } from "../__test-helpers__/jwt";
import { POST as copyFile } from "./from-file/[fileId]/route";
import { DELETE as discard, GET as read } from "./[assetId]/route";
import { GET as metadata } from "./[assetId]/metadata/route";
import { GET as policy } from "./policy/route";
import { POST as upload } from "./route";

const ASSET_ID = "00000000-0000-4000-8000-000000000001";
const ASSET = {
  kind: "attachment",
  id: ASSET_ID,
  target: `/api/assets/${ASSET_ID}`,
  name: "diagram.png",
  mime_type: "image/png",
  size_bytes: 3,
  unclaimed_expires_at: "2026-09-11T00:00:00.000Z",
};

function authedHeaders(): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${VALID_JWT}` };
}

function assetParams(assetId = ASSET_ID) {
  return { params: Promise.resolve({ assetId }) };
}

function fileParams(fileId = "file-1") {
  return { params: Promise.resolve({ fileId }) };
}

beforeEach(() => {
  vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  mockCreateAdapter.mockReturnValue({ request: vi.fn() });
  mockUploadAsset.mockResolvedValue(ASSET);
  mockReadAsset.mockResolvedValue({
    body: new Uint8Array([1, 2, 3]).buffer,
    contentType: "image/png",
    contentLength: 3,
    filename: "diagram.png",
  });
  mockMetadata.mockResolvedValue({
    kind: "attachment",
    target: `/api/assets/${ASSET_ID}`,
    status: "claimed",
  });
  mockDiscardAsset.mockResolvedValue({ discarded: true });
  mockCopyAsset.mockResolvedValue(ASSET);
  mockPolicy.mockResolvedValue({
    kind: "attachment_policy",
    vault: "v",
    server_time: "2026-09-10T00:00:00.000Z",
    unclaimed_ttl_hours: 24,
    revision_retention_days: 30,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("document asset BFF routes", () => {
  it("uploads bounded raw image bytes and returns the stable target", async () => {
    const file = new Uint8Array([1, 2, 3]);
    const response = await upload(
      new Request("http://localhost/api/assets?vault=v&filename=diagram.png", {
        method: "POST",
        headers: {
          ...authedHeaders(),
          "content-type": "image/png",
          "content-length": String(file.byteLength),
        },
        body: file,
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(ASSET);
    expect(mockUploadAsset).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "v",
      filename: "diagram.png",
      mimeType: "image/png",
      bytes: file,
    });
  });

  it("rejects an upload without a vault before touching the upstream adapter", async () => {
    const response = await upload(
      new Request("http://localhost/api/assets?filename=diagram.png", {
        method: "POST",
        headers: {
          ...authedHeaders(),
          "content-type": "image/png",
        },
        body: new Uint8Array([1]),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockUploadAsset).not.toHaveBeenCalled();
  });

  it("reads stable image bytes with the optional document source", async () => {
    const response = await read(
      new Request(
        `http://localhost/api/assets/${ASSET_ID}?vault=v&document=issues%2Freef-001.md&commit=abcdef1`,
        { headers: authedHeaders() },
      ),
      assetParams(),
    );

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mockReadAsset).toHaveBeenCalledWith({
      adapter: expect.anything(),
      vault: "v",
      assetId: ASSET_ID,
      document: "issues/reef-001.md",
      commit: "abcdef1",
    });
  });

  it("proxies metadata, discard, copy, and policy lifecycle operations", async () => {
    const metadataResponse = await metadata(
      new Request(`http://localhost/api/assets/${ASSET_ID}/metadata?vault=v`, {
        headers: authedHeaders(),
      }),
      assetParams(),
    );
    const discardResponse = await discard(
      new Request(`http://localhost/api/assets/${ASSET_ID}?vault=v`, {
        method: "DELETE",
        headers: authedHeaders(),
      }),
      assetParams(),
    );
    const copyResponse = await copyFile(
      new Request("http://localhost/api/assets/from-file/file-1?vault=v", {
        method: "POST",
        headers: authedHeaders(),
      }),
      fileParams(),
    );
    const policyResponse = await policy(
      new Request("http://localhost/api/assets/policy?vault=v", {
        headers: authedHeaders(),
      }),
    );

    expect(metadataResponse.status).toBe(200);
    expect(discardResponse.status).toBe(200);
    expect(copyResponse.status).toBe(201);
    expect(policyResponse.status).toBe(200);
    expect(await metadataResponse.json()).toMatchObject({ status: "claimed" });
    expect(await discardResponse.json()).toEqual({ discarded: true });
    expect(await copyResponse.json()).toEqual(ASSET);
    expect(await policyResponse.json()).toMatchObject({
      unclaimed_ttl_hours: 24,
    });
    expect(mockMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ vault: "v", assetId: ASSET_ID }),
    );
    expect(mockDiscardAsset).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      ASSET_ID,
    );
    expect(mockCopyAsset).toHaveBeenCalledWith(
      expect.anything(),
      "v",
      "file-1",
    );
    expect(mockPolicy).toHaveBeenCalledWith(expect.anything(), "v");
  });
});
