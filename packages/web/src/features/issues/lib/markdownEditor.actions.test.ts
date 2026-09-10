import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: mockApiFetch };
});

import {
  createIssueMarkdownTargetResolver,
  uploadIssueMarkdownFiles,
} from "./markdownEditor.actions";

const ASSET_ID = "00000000-0000-4000-8000-000000000001";

function assetResponse(name: string = "diagram.png"): Response {
  return new Response(
    JSON.stringify({
      kind: "attachment",
      id: ASSET_ID,
      target: `/api/assets/${ASSET_ID}`,
      name,
      mime_type: "image/png",
      size_bytes: 3,
      unclaimed_expires_at: "2026-09-11T00:00:00.000Z",
    }),
    { status: 201 },
  );
}

describe("issue Markdown adapters", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("keeps successful image uploads when another item fails", async () => {
    const first = new File(["one"], "first.png", { type: "image/png" });
    const second = new File(["two"], "second.png", { type: "image/png" });
    const legacyUpload = vi.fn();
    mockApiFetch
      .mockResolvedValueOnce(assetResponse("first.png"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "busy" }), { status: 503 }),
      );

    const result = await uploadIssueMarkdownFiles({
      issueId: "REEF-001",
      vault: "reef-test",
      files: [first, second],
      uploadLegacyAttachment: legacyUpload,
    });

    expect(result).toMatchObject({
      succeeded: 1,
      failed: 1,
      cancelled: 0,
      partial: true,
    });
    expect(result.items.map((item) => item.status)).toEqual([
      "success",
      "failed",
    ]);
    expect(result.items[0]).toMatchObject({
      status: "success",
      asset: {
        kind: "attachment",
        target: `/api/assets/${ASSET_ID}`,
        alt: "first.png",
      },
    });
    expect(legacyUpload).not.toHaveBeenCalled();
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/assets?vault=reef-test&filename=first.png",
      expect.objectContaining({
        method: "POST",
        body: first,
      }),
    );
  });

  it("keeps non-image files on the existing issue attachment path", async () => {
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    const legacyUpload = vi.fn().mockResolvedValue({
      attachment: {
        id: "attachment-1",
        file_uri: "akb://reef-test/issues/reef-001/file/file-1",
        filename: "notes.txt",
      },
      markdown: null,
    });

    const result = await uploadIssueMarkdownFiles({
      issueId: "REEF-001",
      vault: "reef-test",
      files: [file],
      uploadLegacyAttachment: legacyUpload,
    });

    expect(result).toMatchObject({
      succeeded: 1,
      failed: 0,
      cancelled: 0,
      partial: false,
    });
    expect(result.items[0]).toMatchObject({
      status: "success",
      asset: {
        kind: "file",
        target: "akb://reef-test/issues/reef-001/file/file-1",
      },
    });
    expect(legacyUpload).toHaveBeenCalledWith(file);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("resolves stable attachments and rejects cross-vault document links", async () => {
    const resolver = createIssueMarkdownTargetResolver({
      issueId: "REEF-001",
      vault: "reef-test",
      akbWebBase: "https://akb.example",
    });
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          kind: "attachment",
          target: `/api/assets/${ASSET_ID}`,
          status: "claimed",
        }),
        { status: 200 },
      ),
    );

    await expect(
      resolver.resolve(`/api/assets/${ASSET_ID}`, { vault: "reef-test" }),
    ).resolves.toEqual({
      target: `/api/assets/${ASSET_ID}`,
      kind: "attachment",
      status: "available",
      runtimeUrl: `/api/assets/${ASSET_ID}?vault=reef-test`,
    });
    await expect(
      resolver.resolve("akb://other/coll/docs/doc/guide.md", {
        vault: "reef-test",
      }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "cross-vault",
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});
