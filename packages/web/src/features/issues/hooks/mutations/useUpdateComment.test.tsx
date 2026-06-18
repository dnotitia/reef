import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { commentsKey } from "../queries/useComments";
import { useUpdateComment } from "./useUpdateComment";

const mockApiFetch = vi.mocked(apiFetch);

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const COMMENT_ID = "11111111-1111-4111-8111-111111111111";
const BEFORE = {
  id: COMMENT_ID,
  reef_id: "REEF-001",
  body: "before",
  author: "alice",
  created_at: "2026-06-18T01:00:00.000Z",
  edited_at: null,
};
const AFTER = {
  ...BEFORE,
  body: "after",
  edited_at: "2026-06-18T05:00:00.000Z",
};

describe("useUpdateComment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PATCHes the comment and replaces it in the cached thread", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ comment: AFTER }), { status: 200 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(commentsKey("reef-acme", "REEF-001"), [BEFORE]);

    const { result } = renderHook(() => useUpdateComment(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        issueId: "REEF-001",
        vault: "reef-acme",
        commentId: COMMENT_ID,
        body: "after",
      });
    });

    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe(
      `/api/issues/REEF-001/comments/${COMMENT_ID}?vault=reef-acme`,
    );
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ body: "after" });
    expect(
      queryClient.getQueryData(commentsKey("reef-acme", "REEF-001")),
    ).toEqual([AFTER]);
  });
});
