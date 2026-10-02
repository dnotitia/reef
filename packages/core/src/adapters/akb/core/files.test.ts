import { afterEach, describe, expect, it, vi } from "vitest";
import { SchemaValidationError } from "../../../errors";
import { downloadAkbResourceFile } from "./files";
import { makeAdapter, setupFetch } from "./httpTestSupport";

afterEach(() => vi.unstubAllGlobals());

describe("downloadAkbResourceFile", () => {
  it("downloads a canonical file URI from the active vault", async () => {
    const { calls } = setupFetch([
      {
        body: {
          name: "incident.log",
          download_url: "https://files.akb.test/signed/file-1",
          mime_type: "text/plain",
          size_bytes: 5,
        },
      },
      { rawBody: new TextEncoder().encode("hello") },
    ]);

    const result = await downloadAkbResourceFile({
      adapter: makeAdapter(),
      vault: "reef-test",
      fileUri: "akb://reef-test/coll/incidents/file/file-1",
    });

    expect(calls.at(0)?.url).toContain(
      "/api/v1/files/reef-test/file-1/download",
    );
    expect(result.filename).toBe("incident.log");
    expect(new TextDecoder().decode(result.body)).toBe("hello");
  });

  it("rejects invalid and cross-vault file URIs without network access", async () => {
    const { calls } = setupFetch([]);
    const adapter = makeAdapter();

    await expect(
      downloadAkbResourceFile({
        adapter,
        vault: "reef-test",
        fileUri: "akb://other/coll/incidents/file/file-1",
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      downloadAkbResourceFile({
        adapter,
        vault: "reef-test",
        fileUri: "akb://reef-test/coll/incidents/doc/file-1",
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });
});
