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
  createMarkdownTargetResolver,
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

  it("resolves stable attachments and same-vault document links", async () => {
    const resolver = createMarkdownTargetResolver({
      vault: "reef-test",
      akbWebBase: "https://akb.example",
    });
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            kind: "attachment",
            target: `/api/assets/${ASSET_ID}`,
            status: "claimed",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            target: "akb://reef-test/coll/docs/doc/guide.md",
            kind: "document",
            status: "available",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            target: "akb://reef-test/coll/incidents/file/incident-1",
            kind: "file",
            status: "available",
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
    await expect(
      resolver.resolve("akb://reef-test/coll/docs/doc/guide.md", {
        vault: "reef-test",
      }),
    ).resolves.toEqual({
      target: "akb://reef-test/coll/docs/doc/guide.md",
      kind: "document",
      status: "available",
      runtimeUrl: "https://akb.example/vault/reef-test/doc/docs%2Fguide.md",
    });
    await expect(
      resolver.resolve("akb://reef-test/coll/incidents/file/incident-1", {
        vault: "reef-test",
      }),
    ).resolves.toEqual({
      target: "akb://reef-test/coll/incidents/file/incident-1",
      kind: "file",
      status: "available",
      runtimeUrl:
        "/api/files?vault=reef-test&uri=akb%3A%2F%2Freef-test%2Fcoll%2Fincidents%2Ffile%2Fincident-1&download=1",
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(3);
  });

  it("checks document and file access before returning a runtime link", async () => {
    const documentUri = "akb://reef-test/coll/docs/doc/guide.md";
    const fileUri = "akb://reef-test/coll/docs/file/incident-log";
    const resolver = createMarkdownTargetResolver({
      vault: "reef-test",
      akbWebBase: "https://akb.example",
    });
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            target: documentUri,
            kind: "document",
            status: "available",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            target: fileUri,
            kind: "file",
            status: "available",
          }),
          { status: 200 },
        ),
      );

    await expect(
      resolver.resolve(documentUri, {
        vault: "reef-test",
        document: "REEF-001",
        commit: "commit-1",
      }),
    ).resolves.toEqual({
      target: documentUri,
      kind: "document",
      status: "available",
      runtimeUrl: "https://akb.example/vault/reef-test/doc/docs%2Fguide.md",
    });
    await expect(
      resolver.resolve(fileUri, { vault: "reef-test" }),
    ).resolves.toEqual({
      target: fileUri,
      kind: "file",
      status: "available",
      runtimeUrl:
        "/api/files?vault=reef-test&uri=akb%3A%2F%2Freef-test%2Fcoll%2Fdocs%2Ffile%2Fincident-log&download=1",
    });

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/markdown/targets/resolve?vault=reef-test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: documentUri }),
      }),
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/markdown/targets/resolve?vault=reef-test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: fileUri }),
      }),
    );
  });

  it("does not make an AKB document available without a configured web URL", async () => {
    const documentUri = "akb://reef-test/coll/docs/doc/guide.md";
    const resolver = createMarkdownTargetResolver({ vault: "reef-test" });

    await expect(
      resolver.resolve(documentUri, { vault: "reef-test" }),
    ).resolves.toMatchObject({
      target: documentUri,
      kind: "document",
      status: "unavailable",
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("binds asset metadata and runtime URLs to the source document revision", async () => {
    const resolver = createMarkdownTargetResolver({ vault: "reef-test" });
    const controller = new AbortController();
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
      resolver.resolve(`/api/assets/${ASSET_ID}`, {
        vault: "reef-test",
        document: "akb://reef-test/coll/issues/doc/reef-001.md",
        commit: "commit-1",
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      target: `/api/assets/${ASSET_ID}`,
      kind: "attachment",
      status: "available",
      runtimeUrl:
        `/api/assets/${ASSET_ID}?vault=reef-test&document=` +
        "akb%3A%2F%2Freef-test%2Fcoll%2Fissues%2Fdoc%2Freef-001.md&commit=commit-1",
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      `/api/assets/${ASSET_ID}/metadata?vault=reef-test&document=` +
        "akb%3A%2F%2Freef-test%2Fcoll%2Fissues%2Fdoc%2Freef-001.md&commit=commit-1",
      { signal: controller.signal },
    );
  });

  it("does not resolve a cross-vault file through the active vault", async () => {
    const resolver = createMarkdownTargetResolver({ vault: "reef-test" });

    await expect(
      resolver.resolve("akb://other/coll/incidents/file/incident-1", {
        vault: "reef-test",
      }),
    ).resolves.toMatchObject({ status: "unavailable", reason: "cross-vault" });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
