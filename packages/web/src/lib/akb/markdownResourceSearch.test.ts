import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiFetch, mockThrowHttpError } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
  mockThrowHttpError: vi.fn(),
}));

vi.mock("@/lib/apiClient", () => ({
  apiFetch: mockApiFetch,
  throwHttpError: mockThrowHttpError,
}));

import { markdownResourceSearchAdapter } from "./markdownResourceSearch";

describe("markdownResourceSearchAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the authenticated Reef route and maps canonical document and file targets", async () => {
    const signal = new AbortController().signal;
    mockApiFetch.mockResolvedValue(
      Response.json({
        results: [
          {
            uri: "akb://reef-test/coll/research/doc/plan.md",
            title: "Plan",
            kind: "document",
            snippet: "A short summary",
          },
          {
            uri: "akb://reef-test/issues/file/incident-log",
            title: "incident.log",
            kind: "file",
          },
        ],
      }),
    );

    await expect(
      markdownResourceSearchAdapter.search(" incident ", {
        vault: " reef-test ",
        signal,
      }),
    ).resolves.toEqual([
      {
        id: "akb://reef-test/coll/research/doc/plan.md",
        title: "Plan",
        target: "akb://reef-test/coll/research/doc/plan.md",
        kind: "document",
        snippet: "A short summary",
      },
      {
        id: "akb://reef-test/issues/file/incident-log",
        title: "incident.log",
        target: "akb://reef-test/issues/file/incident-log",
        kind: "file",
      },
    ]);

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/documents/search?vault=reef-test&q=incident&include_files=true",
      { signal },
    );
  });

  it("skips requests without a vault or a non-empty query", async () => {
    await expect(
      markdownResourceSearchAdapter.search("incident", { vault: "" }),
    ).resolves.toEqual([]);
    await expect(
      markdownResourceSearchAdapter.search("  ", { vault: "reef-test" }),
    ).resolves.toEqual([]);
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("preserves route errors so the shared picker can render its error state", async () => {
    const response = new Response(null, { status: 503 });
    mockApiFetch.mockResolvedValue(response);
    mockThrowHttpError.mockRejectedValue(new Error("service unavailable"));

    await expect(
      markdownResourceSearchAdapter.search("incident", { vault: "reef-test" }),
    ).rejects.toThrow("service unavailable");
    expect(mockThrowHttpError).toHaveBeenCalledWith(
      response,
      "Resource search failed: 503",
    );
  });
});
