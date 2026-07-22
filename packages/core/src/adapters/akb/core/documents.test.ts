import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeTestAkbAdapter,
  setupFetch,
} from "../../../agents/tools/__test-helpers__/fetchMock";
import { resolveDocumentTitles, searchDocuments } from "./documents";

afterEach(() => vi.unstubAllGlobals());

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

describe("searchDocuments", () => {
  it("never exposes the internal initialization marker", async () => {
    const { calls } = setupFetch([
      {
        body: {
          results: [
            {
              uri: "akb://reef-test/coll/overview/doc/reef-initialization.md",
              title: "Reef workspace initialization",
            },
            {
              uri: "akb://reef-test/coll/docs/doc/spec.md",
              title: "Spec",
            },
          ],
        },
      },
    ]);

    await expect(
      searchDocuments({
        adapter: makeTestAkbAdapter(),
        vault: "reef-test",
        query: "reef",
        limit: 1,
      }),
    ).resolves.toEqual([
      {
        uri: "akb://reef-test/coll/docs/doc/spec.md",
        title: "Spec",
        tags: [],
      },
    ]);
    expect(new URL(calls[0].url).searchParams.get("limit")).toBe("2");
  });
});
