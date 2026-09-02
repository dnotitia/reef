import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import type { IssueListItem } from "@reef/core";
import { useInfiniteIssueList } from "./useInfiniteIssueList";

const mockApiFetch = vi.mocked(apiFetch);

const issue = (id: string): IssueListItem => ({
  id,
  title: `Issue ${id}`,
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
});

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useInfiniteIssueList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts at limit 100 and follows the opaque cursor once", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            issues: [issue("REEF-001")],
            next_cursor: "opaque-1",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ issues: [issue("REEF-002")] }), {
          status: 200,
        }),
      );

    const { result } = renderHook(
      () =>
        useInfiniteIssueList("reef-acme", {
          sort_field: "priority",
          sort_order: "desc",
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));

    expect(mockApiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/issues?vault=reef-acme&limit=100&sort_field=priority&sort_order=desc",
    );
    expect(mockApiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/issues?vault=reef-acme&limit=100&cursor=opaque-1&sort_field=priority&sort_order=desc",
    );
    expect(result.current.data?.pages.flatMap((page) => page.issues)).toEqual([
      issue("REEF-001"),
      issue("REEF-002"),
    ]);
  });

  it("refetches a fresh cached list when the hook remounts", async () => {
    const query = {
      sort_field: "priority",
      sort_order: "desc",
    } as const;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [] }), { status: 200 }),
    );

    const first = renderHook(() => useInfiniteIssueList("reef-acme", query), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forced issue-list failure" }), {
        status: 500,
      }),
    );
    const second = renderHook(() => useInfiniteIssueList("reef-acme", query), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(second.result.current.isError).toBe(true));

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });
});
