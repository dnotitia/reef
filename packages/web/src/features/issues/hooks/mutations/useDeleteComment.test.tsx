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
import { commentsKey } from "../queries/useComments";
import { useDeleteComment } from "./useDeleteComment";

const mockApiFetch = vi.mocked(apiFetch);
const ROOT_ID = "11111111-1111-4111-8111-111111111111";
const REPLY_ID = "22222222-2222-4222-8222-222222222222";
const SIBLING_ID = "33333333-3333-4333-8333-333333333333";

const COMMENTS = [
  {
    id: ROOT_ID,
    reef_id: "REEF-001",
    body: "root",
    author: "alice",
    created_at: "2026-06-18T01:00:00.000Z",
    edited_at: null,
  },
  {
    id: REPLY_ID,
    reef_id: "REEF-001",
    body: "reply",
    author: "alice",
    created_at: "2026-06-18T02:00:00.000Z",
    edited_at: null,
    parent_comment_id: ROOT_ID,
    thread_root_id: ROOT_ID,
  },
  {
    id: SIBLING_ID,
    reef_id: "REEF-001",
    body: "sibling",
    author: "bob",
    created_at: "2026-06-18T03:00:00.000Z",
    edited_at: null,
  },
];

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useDeleteComment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DELETEs the comment, removes the server-confirmed subtree, and invalidates notifications", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ deleted_comment_ids: [ROOT_ID, REPLY_ID] }),
        { status: 200 },
      ),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(commentsKey("reef-acme", "REEF-001"), COMMENTS);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteComment(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        issueId: "REEF-001",
        vault: "reef-acme",
        commentId: ROOT_ID,
      });
    });

    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe(
      `/api/issues/REEF-001/comments/${ROOT_ID}?vault=reef-acme`,
    );
    expect(init?.method).toBe("DELETE");
    expect(
      queryClient.getQueryData(commentsKey("reef-acme", "REEF-001")),
    ).toEqual([COMMENTS[2]]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["notifications", "reef-acme"],
    });
  });

  it("keeps the cached thread when the request fails", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status: 500 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(commentsKey("reef-acme", "REEF-001"), COMMENTS);

    const { result } = renderHook(() => useDeleteComment(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current
        .mutateAsync({
          issueId: "REEF-001",
          vault: "reef-acme",
          commentId: ROOT_ID,
        })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(
      queryClient.getQueryData(commentsKey("reef-acme", "REEF-001")),
    ).toEqual(COMMENTS);
  });
});
