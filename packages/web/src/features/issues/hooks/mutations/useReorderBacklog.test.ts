import { apiFetch } from "@/lib/apiClient";
import type { IssueListItem } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { useReorderBacklog } from "./useReorderBacklog";

const mockApiFetch = vi.mocked(apiFetch);

// computeReorderedRanks / the hook read id + rank off each row.
function ordered(...specs: Array<[string, number | null]>): IssueListItem[] {
  return specs.map(([id, rank]) => ({
    id,
    rank,
  })) as unknown as IssueListItem[];
}

function wrap() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

function postBodies() {
  return mockApiFetch.mock.calls
    .filter((c) => (c[1] as RequestInit | undefined)?.method === "POST")
    .map((c) => ({
      url: String(c[0]),
      body: JSON.parse(String((c[1] as RequestInit).body)),
    }));
}

describe("useReorderBacklog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: {}, content: "" }), { status: 200 }),
    );
  });

  it("persists the rank writes as one atomic reorder request (REEF-129)", async () => {
    const { wrapper } = wrap();
    const { result } = renderHook(() => useReorderBacklog(), { wrapper });

    // A(1000) B(2000) C(3000); drag C up between A and B → one row, rank 1500.
    await result.current.mutateAsync({
      vault: "reef-acme",
      ordered: ordered(["A", 1000], ["B", 2000], ["C", 3000]),
      fromIndex: 2,
      toIndex: 1,
    });

    // One POST to the atomic reorder endpoint — does not per-row PATCHes.
    const posts = postBodies();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/api/issues/reorder");
    expect(posts[0].body).toEqual({
      vault: "reef-acme",
      assignments: [{ id: "C", rank: 1500 }],
    });
  });

  it("optimistically stamps the new rank onto the vault list cache", async () => {
    const { queryClient, wrapper } = wrap();
    queryClient.setQueryData<IssueListItem[]>(
      ["issues", "list", "reef-acme", { status: ["backlog"] }],
      ordered(["A", 1000], ["B", 2000], ["C", 3000]),
    );
    const { result } = renderHook(() => useReorderBacklog(), { wrapper });

    void result.current.mutate({
      vault: "reef-acme",
      ordered: ordered(["A", 1000], ["B", 2000], ["C", 3000]),
      fromIndex: 2,
      toIndex: 1,
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<IssueListItem[]>([
        "issues",
        "list",
        "reef-acme",
        { status: ["backlog"] },
      ]);
      expect(cached?.find((i) => i.id === "C")?.rank).toBe(1500);
    });
  });

  it("reverts the cache when a rank write fails", async () => {
    const { queryClient, wrapper } = wrap();
    const original = ordered(["A", 1000], ["B", 2000], ["C", 3000]);
    queryClient.setQueryData<IssueListItem[]>(
      ["issues", "list", "reef-acme", { status: ["backlog"] }],
      original,
    );
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );
    const { result } = renderHook(() => useReorderBacklog(), { wrapper });

    await result.current
      .mutateAsync({
        vault: "reef-acme",
        ordered: original,
        fromIndex: 2,
        toIndex: 1,
      })
      .catch(() => {});

    await waitFor(() => {
      const cached = queryClient.getQueryData<IssueListItem[]>([
        "issues",
        "list",
        "reef-acme",
        { status: ["backlog"] },
      ]);
      // Reverted to the original rank (3000), not the optimistic 1500.
      expect(cached?.find((i) => i.id === "C")?.rank).toBe(3000);
    });
  });
});
