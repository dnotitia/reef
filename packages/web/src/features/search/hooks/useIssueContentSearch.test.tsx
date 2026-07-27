import { apiFetch } from "@/lib/apiClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueContentSearch } from "./useIssueContentSearch";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
});

describe("useIssueContentSearch", () => {
  it("does not request content for fewer than two Unicode code points", () => {
    renderHook(() => useIssueContentSearch("가", "reef-test", 10), {
      wrapper: makeWrapper(),
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("does not request content when the query cannot fit a bounded snippet", () => {
    renderHook(() => useIssueContentSearch("a".repeat(181), "reef-test", 10), {
      wrapper: makeWrapper(),
    });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("uses a query-scoped key and parses the response", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ results: [], has_more: false })),
    );
    const { result } = renderHook(
      () => useIssueContentSearch("  검색  ", "reef-test", 10),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/search-content?vault=reef-test&q=%EA%B2%80%EC%83%89&limit=10",
    );
    expect(result.current.data).toEqual({
      results: [],
      has_more: false,
      query: "검색",
      limit: 10,
    });
  });

  it("keeps the current query's rows while a larger limit loads", async () => {
    let resolveExpanded: ((response: Response) => void) | undefined;
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                reef_id: "REEF-001",
                title: "First",
                snippet: "needle",
                source: "body",
                score: 0.5,
                match_id: "body:one",
              },
            ],
            has_more: true,
          }),
        ),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveExpanded = resolve;
          }),
      );
    const { result, rerender } = renderHook(
      ({ limit }) => useIssueContentSearch("needle", "reef-test", limit),
      { wrapper: makeWrapper(), initialProps: { limit: 10 } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ limit: 20 });
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.data?.results).toHaveLength(1);
    expect(result.current.isPlaceholderData).toBe(true);

    await act(async () => {
      resolveExpanded?.(
        new Response(JSON.stringify({ results: [], has_more: false })),
      );
    });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
  });
});
