import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../test-support/akb/fetchMock";
import { SchemaValidationError } from "../../../errors";
import { getAkbDocument, resolveDocumentTitles } from "./documents";

afterEach(() => vi.unstubAllGlobals());

describe("getAkbDocument", () => {
  it("reads bare and greedily nested document URIs with their parsed paths", async () => {
    const firstUri = "akb://reef-test/doc/root.md";
    const secondUri = "akb://reef-test/coll/a/doc/b/doc/c.md";
    const { calls } = setupFetch([
      {
        body: {
          uri: firstUri,
          vault: "reef-test",
          path: "root.md",
          title: "Root",
          type: "document",
          status: "active",
          tags: [],
        },
      },
      {
        body: {
          uri: secondUri,
          vault: "reef-test",
          path: "a/doc/b/c.md",
          title: "Nested",
          type: "document",
          status: "active",
          tags: [],
        },
      },
    ]);

    await getAkbDocument({
      adapter: makeTestAkbAdapter(),
      vault: "reef-test",
      uri: firstUri,
    });
    await getAkbDocument({
      adapter: makeTestAkbAdapter(),
      vault: "reef-test",
      uri: secondUri,
    });

    expect(new URL(calls[0].url).pathname).toBe(
      "/api/v1/documents/reef-test/root.md",
    );
    expect(new URL(calls[1].url).pathname).toBe(
      "/api/v1/documents/reef-test/a/doc/b/c.md",
    );
  });

  it("rejects malformed and cross-vault URIs before document I/O", async () => {
    const { calls } = setupFetch([]);
    const adapter = makeTestAkbAdapter();
    const repeatedMalformedMarkers = `akb://reef-test/coll/${"a/doc/".repeat(64)}a\n/doc/root.md`;

    for (const uri of [
      "akb://other/coll/research/doc/report.md",
      "akb://reef-test/coll/research/doc/",
      repeatedMalformedMarkers,
    ]) {
      await expect(
        getAkbDocument({ adapter, vault: "reef-test", uri }),
      ).rejects.toBeInstanceOf(SchemaValidationError);
    }

    expect(calls).toHaveLength(0);
  });
});

describe("resolveDocumentTitles", () => {
  it("GETs document titles from canonical akb document URIs", async () => {
    const { calls } = setupFetch([
      {
        body: {
          uri: "akb://reef-test/coll/research/doc/report.md",
          vault: "reef-test",
          path: "research/report.md",
          title: "Research Report",
          type: "report",
          status: "active",
          tags: [],
        },
      },
    ]);

    const documents = await resolveDocumentTitles({
      adapter: makeTestAkbAdapter(),
      vault: "reef-test",
      uris: ["akb://reef-test/coll/research/doc/report.md"],
    });

    expect(new URL(calls[0].url).pathname).toBe(
      "/api/v1/documents/reef-test/research/report.md",
    );
    expect(documents).toEqual([
      {
        uri: "akb://reef-test/coll/research/doc/report.md",
        title: "Research Report",
        resource_type: "doc",
      },
    ]);
  });

  it("returns a null title when lookup fails so editing can continue", async () => {
    setupFetch([{ status: 404, body: { detail: "not found" } }]);

    const documents = await resolveDocumentTitles({
      adapter: makeTestAkbAdapter(),
      vault: "reef-test",
      uris: ["akb://reef-test/coll/research/doc/missing.md"],
    });

    expect(documents).toEqual([
      {
        uri: "akb://reef-test/coll/research/doc/missing.md",
        title: null,
        resource_type: "doc",
      },
    ]);
  });

  it("does not resolve cross-vault URIs through the current vault adapter", async () => {
    const { calls } = setupFetch([]);

    const documents = await resolveDocumentTitles({
      adapter: makeTestAkbAdapter(),
      vault: "reef-test",
      uris: ["akb://other/coll/research/doc/report.md"],
    });

    expect(calls).toHaveLength(0);
    expect(documents[0]).toEqual({
      uri: "akb://other/coll/research/doc/report.md",
      title: null,
      resource_type: "doc",
    });
  });
});
