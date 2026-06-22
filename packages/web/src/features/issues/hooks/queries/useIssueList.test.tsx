import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";
import { useIssueList } from "./useIssueList";

const mockApiFetch = vi.mocked(apiFetch);

const ISSUES: IssueMetadata[] = [
  {
    id: "REEF-001",
    title: "Sample",
    status: "todo",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-05-01T00:00:00.000Z",
    updated_by: "alice",
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useIssueList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls GET /api/issues?vault={vault} and returns issues array", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: ISSUES }), { status: 200 }),
    );

    const { result } = renderHook(() => useIssueList("reef-acme"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(ISSUES);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/issues?vault=reef-acme");
  });

  it("is disabled when vault is empty", () => {
    const { result } = renderHook(() => useIssueList(""), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("surfaces isError on non-200 response", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Workspace not found." }), {
        status: 404,
      }),
    );

    const { result } = renderHook(() => useIssueList("reef-acme"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Workspace not found");
  });

  it("keeps prior same-vault rows as placeholder by default during a key change", async () => {
    const aliceRows = [{ ...ISSUES[0], id: "REEF-A" }] as IssueMetadata[];
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: aliceRows }), { status: 200 }),
    );
    let resolveSecond: (r: Response) => void = () => {};
    mockApiFetch.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveSecond = res;
      }),
    );

    const { result, rerender } = renderHook(
      ({ q }: { q: Record<string, string> }) => useIssueList("reef-acme", q),
      {
        wrapper: createWrapper(),
        initialProps: { q: { assigned_to: "alice" } },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual(aliceRows));

    rerender({ q: { assigned_to: "bob" } });
    // Same vault, new query key → prior rows stay visible as placeholder.
    expect(result.current.data).toEqual(aliceRows);

    resolveSecond(
      new Response(JSON.stringify({ issues: [] }), { status: 200 }),
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
  });

  it("drops prior rows (no placeholder) on a key change when keepPreviousData is false (REEF-267)", async () => {
    // The identity-scoped My Work query opts out so an account switch never
    // reuses the previous login's rows in the same vault.
    const aliceRows = [{ ...ISSUES[0], id: "REEF-A" }] as IssueMetadata[];
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: aliceRows }), { status: 200 }),
    );
    let resolveSecond: (r: Response) => void = () => {};
    mockApiFetch.mockReturnValueOnce(
      new Promise<Response>((res) => {
        resolveSecond = res;
      }),
    );

    const { result, rerender } = renderHook(
      ({ q }: { q: Record<string, string> }) =>
        useIssueList("reef-acme", q, { keepPreviousData: false }),
      {
        wrapper: createWrapper(),
        initialProps: { q: { assigned_to: "alice" } },
      },
    );
    await waitFor(() => expect(result.current.data).toEqual(aliceRows));

    rerender({ q: { assigned_to: "bob" } });
    // No placeholder: the prior login's rows are NOT shown while bob loads.
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);

    resolveSecond(
      new Response(JSON.stringify({ issues: [] }), { status: 200 }),
    );
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
