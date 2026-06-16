import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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
import { useDeleteIssue } from "./useDeleteIssue";

const mockApiFetch = vi.mocked(apiFetch);

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useDeleteIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends DELETE to /api/issues/{id}?vault={vault}", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useDeleteIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "REEF-001", vault: "reef-acme" });
    });

    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/issues/REEF-001?vault=reef-acme");
    expect(init?.method).toBe("DELETE");
  });

  it("treats 404 as soft success (already gone)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Issue not found." }), {
        status: 404,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useDeleteIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "REEF-001", vault: "reef-acme" });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("invalidates list + detail on success", async () => {
    mockApiFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "REEF-001", vault: "reef-acme" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "list", "reef-acme"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "detail", "reef-acme", "REEF-001"],
    });
  });

  it("propagates non-204/404 errors", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Your session has expired." }), {
        status: 401,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useDeleteIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current
        .mutateAsync({ id: "REEF-001", vault: "reef-acme" })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
