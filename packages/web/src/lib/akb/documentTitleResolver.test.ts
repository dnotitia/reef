import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAkbDocumentTitleCacheForTests,
  resolveAkbDocumentTitles,
} from "./documentTitleResolver";

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: mockApiFetch };
});

const URI = "akb://reef-test/coll/research/doc/report.md";

afterEach(() => {
  clearAkbDocumentTitleCacheForTests();
  vi.clearAllMocks();
});

describe("resolveAkbDocumentTitles", () => {
  it("deduplicates repeated URI lookups through the route handler", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          documents: [{ uri: URI, title: "Research Report" }],
        }),
      ),
    );

    const titles = await resolveAkbDocumentTitles("reef-test", [URI, URI]);
    const second = await resolveAkbDocumentTitles("reef-test", [URI]);

    expect(titles.get(URI)).toBe("Research Report");
    expect(second.get(URI)).toBe("Research Report");
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("stores null on failed route responses so editing can keep fallback text", async () => {
    mockApiFetch.mockResolvedValue(new Response("{}", { status: 500 }));

    const titles = await resolveAkbDocumentTitles("reef-test", [URI]);

    expect(titles.get(URI)).toBeNull();
  });
});
