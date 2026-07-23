import { apiFetch } from "@/lib/apiClient";
import type { Comment } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commentsKey, useComments } from "./useComments";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const CACHED_COMMENT: Comment = {
  id: "00000000-0000-4000-8000-000000000001",
  reef_id: "REEF-001",
  body: "cached reply",
  author: "alice",
  created_at: "2026-07-23T00:00:00.000Z",
  edited_at: null,
  parent_comment_id: null,
  thread_root_id: null,
};

const SERVER_COMMENT: Comment = {
  ...CACHED_COMMENT,
  id: "00000000-0000-4000-8000-000000000002",
  body: "server reply",
};

describe("useComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs /api/issues/{id}/comments and returns the thread", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ comments: [SERVER_COMMENT] }), {
        status: 200,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useComments("REEF-001", "reef-acme"), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([SERVER_COMMENT]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001/comments?vault=reef-acme",
    );
  });

  it("is disabled without an issue id or vault", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useComments("", ""), {
      wrapper: wrapper(queryClient),
    });

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("revalidates a fresh persisted snapshot when the timeline mounts", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(commentsKey("reef-acme", "REEF-001"), [
      CACHED_COMMENT,
    ]);
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ comments: [SERVER_COMMENT] }), {
        status: 200,
      }),
    );

    const { result } = renderHook(() => useComments("REEF-001", "reef-acme"), {
      wrapper: wrapper(queryClient),
    });

    expect(result.current.data).toEqual([CACHED_COMMENT]);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data).toEqual([SERVER_COMMENT]));
  });
});
