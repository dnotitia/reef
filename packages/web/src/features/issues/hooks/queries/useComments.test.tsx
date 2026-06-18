import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { useComments } from "./useComments";

const mockApiFetch = vi.mocked(apiFetch);

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const COMMENT = {
  id: "11111111-1111-4111-8111-111111111111",
  reef_id: "REEF-001",
  body: "hi",
  author: "alice",
  created_at: "2026-06-18T01:00:00.000Z",
  edited_at: null,
};

describe("useComments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GETs /api/issues/{id}/comments and returns the thread", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ comments: [COMMENT] }), { status: 200 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useComments("REEF-001", "reef-acme"), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([COMMENT]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001/comments?vault=reef-acme",
    );
  });

  it("is disabled without an issue id or vault", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderHook(() => useComments("", ""), { wrapper: wrapper(queryClient) });
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
