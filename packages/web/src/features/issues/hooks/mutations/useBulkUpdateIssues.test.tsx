import { apiFetch } from "@/lib/apiClient";
import type { IssueListItem } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { purgeAll, upsertIssues } from "../../stores/issueEntityStore";
import { useIssueSelectionStore } from "../../stores/useIssueSelectionStore";
import { useBulkUpdateIssues } from "./useBulkUpdateIssues";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);
const issues: IssueListItem[] = ["REEF-001", "REEF-002", "REEF-003"].map(
  (id) => ({
    id,
    title: id,
    status: "todo",
    created_at: "2026-01-01T00:00:00Z",
    created_by: "alice",
    updated_at: "2026-01-01T00:00:00Z",
    updated_by: "alice",
  }),
);

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useBulkUpdateIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    purgeAll();
    useIssueSelectionStore.getState().clear();
    upsertIssues("reef-test", issues);
  });

  it("fans out strictly sequentially, preserves successes, and reconciles once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockApiFetch.mockImplementation(async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      const id = decodeURIComponent(String(url).split("/").at(-1) ?? "");
      inFlight -= 1;
      if (id === "REEF-002") {
        return new Response(JSON.stringify({ error: "failed" }), {
          status: 500,
        });
      }
      const issue = issues.find((item) => item.id === id);
      return new Response(
        JSON.stringify({
          issue: { ...issue, status: "in_progress" },
          content: "",
        }),
        { status: 200 },
      );
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["issues", "list", "reef-test"], issues);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    for (const issue of issues)
      useIssueSelectionStore.getState().toggle(issue.id);
    const { result } = renderHook(() => useBulkUpdateIssues("reef-test"), {
      wrapper: wrapper(queryClient),
    });

    let runResult: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      runResult = await result.current.run(
        issues.map((issue) => issue.id),
        { kind: "status", value: "in_progress" },
      );
    });

    expect(maxInFlight).toBe(1);
    expect(runResult?.succeeded).toEqual(["REEF-001", "REEF-003"]);
    expect(runResult?.failures.map((failure) => failure.id)).toEqual([
      "REEF-002",
    ]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "REEF-002",
    ]);
    expect(
      invalidateSpy.mock.calls.filter(
        (call) => call[0]?.queryKey?.[1] === "list",
      ),
    ).toHaveLength(1);
    expect(
      invalidateSpy.mock.calls.filter(
        (call) => call[0]?.queryKey?.[1] === "relations",
      ),
    ).toHaveLength(1);
  });

  it("keeps unchanged items request-free and classifies a stale id as not found", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "missing" }), { status: 404 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useBulkUpdateIssues("reef-test"), {
      wrapper: wrapper(queryClient),
    });
    useIssueSelectionStore.getState().toggle("REEF-001");
    useIssueSelectionStore.getState().toggle("REEF-404");

    let runResult: Awaited<ReturnType<typeof result.current.run>> | undefined;
    await act(async () => {
      runResult = await result.current.run(["REEF-001", "REEF-404"], {
        kind: "status",
        value: "todo",
      });
    });

    expect(runResult?.unchanged).toEqual(["REEF-001"]);
    expect(runResult?.failures[0]).toMatchObject({
      id: "REEF-404",
      reason: "not_found",
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "REEF-404",
    ]);

    act(() => result.current.dismissFailure("REEF-404"));
    expect(result.current.failures).toEqual([]);
    expect(useIssueSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("keeps unrelated failures in the tray when one failed item is retried", async () => {
    const attempts = new Map<string, number>();
    mockApiFetch.mockImplementation(async (url) => {
      const id = decodeURIComponent(String(url).split("/").at(-1) ?? "");
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      if ((id === "REEF-001" || id === "REEF-002") && attempt === 1) {
        return new Response(JSON.stringify({ error: "failed" }), {
          status: 500,
        });
      }
      const issue = issues.find((item) => item.id === id);
      return new Response(
        JSON.stringify({
          issue: { ...issue, status: "in_progress" },
          content: "",
        }),
        { status: 200 },
      );
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["issues", "list", "reef-test"], issues);
    const { result } = renderHook(() => useBulkUpdateIssues("reef-test"), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.run(
        issues.map((issue) => issue.id),
        { kind: "status", value: "in_progress" },
      );
    });
    expect(result.current.failures.map((failure) => failure.id)).toEqual([
      "REEF-001",
      "REEF-002",
    ]);

    await act(async () => {
      await result.current.retry(result.current.failures[0]);
    });
    expect(result.current.failures.map((failure) => failure.id)).toEqual([
      "REEF-002",
    ]);
  });
});
