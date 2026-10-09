import { AuthError, NotFoundError } from "../../../errors";
import type { AkbAdapter } from "./http";
import { resolveAkbMarkdownTarget } from "./markdownTargets";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DOCUMENT_URI = "akb://reef-test/coll/docs/doc/guide.md";
const FILE_URI = "akb://reef-test/coll/docs/file/incident-log";

const request = vi.fn<AkbAdapter["request"]>();
const adapter: AkbAdapter = { request };

beforeEach(() => request.mockReset());

describe("resolveAkbMarkdownTarget", () => {
  it("checks document and file access without returning runtime URLs", async () => {
    request
      .mockResolvedValueOnce({
        uri: DOCUMENT_URI,
        vault: "reef-test",
        path: "docs/guide.md",
        title: "Guide",
        type: "document",
        status: "active",
      })
      .mockResolvedValueOnce({
        kind: "file",
        uri: FILE_URI,
        name: "incident-log.txt",
        mime_type: "text/plain",
        size_bytes: 8,
      });

    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: DOCUMENT_URI,
      }),
    ).resolves.toEqual({
      target: DOCUMENT_URI,
      kind: "document",
      status: "available",
    });
    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: FILE_URI,
      }),
    ).resolves.toEqual({
      target: FILE_URI,
      kind: "file",
      status: "available",
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/documents/reef-test/docs/guide.md",
      { resource: "document docs/guide.md" },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/files/reef-test/incident-log",
      { resource: "file incident-log" },
    );
  });

  it("does not request cross-vault or unsupported targets", async () => {
    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: "akb://other/coll/docs/doc/guide.md",
      }),
    ).resolves.toMatchObject({ status: "unavailable", reason: "cross-vault" });
    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: "akb://reef-test/table/pipeline",
      }),
    ).resolves.toMatchObject({ status: "unavailable", reason: "unsupported" });
    expect(request).not.toHaveBeenCalled();
  });

  it("distinguishes deleted and inaccessible resources", async () => {
    request
      .mockRejectedValueOnce(new NotFoundError({ resource: "document" }))
      .mockRejectedValueOnce(new AuthError({ origin: "akb", status: 403 }));

    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: DOCUMENT_URI,
      }),
    ).resolves.toMatchObject({ status: "unavailable", reason: "deleted" });
    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: FILE_URI,
      }),
    ).resolves.toMatchObject({ status: "unavailable", reason: "inaccessible" });
  });

  it("propagates invalid-session and account-denial errors to the route boundary", async () => {
    const sessionExpired = new AuthError({ origin: "akb", status: 401 });
    request.mockRejectedValueOnce(sessionExpired);

    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: DOCUMENT_URI,
      }),
    ).rejects.toBe(sessionExpired);

    const accountDenied = new AuthError({
      origin: "akb",
      code: "membership_required",
      status: 403,
    });
    request.mockRejectedValueOnce(accountDenied);
    await expect(
      resolveAkbMarkdownTarget({
        adapter,
        vault: "reef-test",
        target: DOCUMENT_URI,
      }),
    ).rejects.toBe(accountDenied);
  });
});
