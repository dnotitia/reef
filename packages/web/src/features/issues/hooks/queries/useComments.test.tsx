import {
  createQueryWrapper,
  createTestQueryClient,
} from "@/test-support/query";
import { apiFetch } from "@/lib/apiClient";
import type { Comment } from "@reef/core";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commentsKey, useComments } from "./useComments";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);

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
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useComments("REEF-001", "reef-acme"), {
      wrapper: createQueryWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([SERVER_COMMENT]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001/comments?vault=reef-acme",
    );
  });

  it.each([
    ["", "reef-acme"],
    ["REEF-001", ""],
  ])("is disabled for issue %j and vault %j", (issueId, vault) => {
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useComments(issueId, vault), {
      wrapper: createQueryWrapper(queryClient),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("revalidates a fresh persisted snapshot when the timeline mounts", async () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(commentsKey("reef-acme", "REEF-001"), [
      CACHED_COMMENT,
    ]);
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ comments: [SERVER_COMMENT] }), {
        status: 200,
      }),
    );

    const { result } = renderHook(() => useComments("REEF-001", "reef-acme"), {
      wrapper: createQueryWrapper(queryClient),
    });

    expect(result.current.data).toEqual([CACHED_COMMENT]);
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data).toEqual([SERVER_COMMENT]));
  });
});
