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
import { buildIssueReorderTargetFromDrop } from "../../lib/issueReorder";

const mockApiFetch = vi.mocked(apiFetch);

// computeReorderedRanks / the hook read id + rank off each row.
function ordered(...specs: Array<[string, number | null]>): IssueListItem[] {
  return specs.map(([id, rank]) => ({
    id,
    title: id,
    status: "backlog",
    rank,
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  }));
}

function targetFor(issues: IssueListItem[], activeId: string, overId: string) {
  const target = buildIssueReorderTargetFromDrop(issues, activeId, overId);
  if (!target) throw new Error("expected a reorder target");
  return target;
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
      new Response(
        JSON.stringify({ ok: true, assignments: [{ id: "C", rank: 1500 }] }),
        { status: 200 },
      ),
    );
  });

  it("persists the rank writes as one atomic reorder request (REEF-129)", async () => {
    const { wrapper } = wrap();
    const { result } = renderHook(() => useReorderBacklog(), { wrapper });

    // A(1000) B(2000) C(3000); drag C up between A and B → one row, rank 1500.
    const list = ordered(["A", 1000], ["B", 2000], ["C", 3000]);
    await result.current.mutateAsync({
      vault: "reef-acme",
      scope: "backlog",
      ...targetFor(list, "C", "B"),
    });

    // One POST to the atomic reorder endpoint — does not per-row PATCHes.
    const posts = postBodies();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/api/issues/reorder");
    expect(posts[0].body).toMatchObject({
      vault: "reef-acme",
      scope: "backlog",
      issue_id: "C",
      before_id: "A",
      after_id: "B",
      expected: {
        issue_rank: 3000,
        before_rank: 1000,
        after_rank: 2000,
      },
    });
  });

  it("revalidates only rank and updated_at list variants after success", async () => {
    const { queryClient, wrapper } = wrap();
    const rows = ordered(["A", 1000], ["B", 2000]);
    const rankKey = [
      "issues",
      "list",
      "reef-acme",
      { sort_field: "rank", sort_order: "asc" },
    ] as const;
    const updatedAtKey = [
      "issues",
      "list",
      "reef-acme",
      { sort_field: "updated_at", sort_order: "desc" },
    ] as const;
    const priorityKey = [
      "issues",
      "list",
      "reef-acme",
      { sort_field: "priority", sort_order: "desc" },
    ] as const;
    queryClient.setQueryData(rankKey, rows);
    queryClient.setQueryData(updatedAtKey, rows);
    queryClient.setQueryData(priorityKey, rows);
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          assignments: [{ id: "B", rank: 1500 }],
        }),
        { status: 200 },
      ),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useReorderBacklog(), { wrapper });

    await result.current.mutateAsync({
      vault: "reef-acme",
      scope: "backlog",
      ...targetFor(rows, "B", "A"),
    });

    const listCall = invalidateSpy.mock.calls.find(
      ([options]) => options?.queryKey?.[1] === "list",
    );
    expect(listCall?.[0]).toMatchObject({
      queryKey: ["issues", "list", "reef-acme"],
      refetchType: "all",
      predicate: expect.any(Function),
    });
    const predicate = listCall?.[0]?.predicate as unknown as
      | ((query: { queryKey: readonly unknown[] }) => boolean)
      | undefined;
    expect(predicate?.({ queryKey: rankKey })).toBe(true);
    expect(predicate?.({ queryKey: updatedAtKey })).toBe(true);
    expect(predicate?.({ queryKey: priorityKey })).toBe(false);
  });

  it("optimistically stamps the new rank onto the vault list cache", async () => {
    const { queryClient, wrapper } = wrap();
    queryClient.setQueryData<IssueListItem[]>(
      ["issues", "list", "reef-acme", { status: ["backlog"] }],
      ordered(["A", 1000], ["B", 2000], ["C", 3000]),
    );
    const { result } = renderHook(() => useReorderBacklog(), { wrapper });

    const list = ordered(["A", 1000], ["B", 2000], ["C", 3000]);
    void result.current.mutate({
      vault: "reef-acme",
      scope: "backlog",
      ...targetFor(list, "C", "B"),
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
        scope: "backlog",
        ...targetFor(original, "C", "B"),
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
