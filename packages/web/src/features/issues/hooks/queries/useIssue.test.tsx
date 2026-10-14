import {
  createQueryWrapper,
  createTestQueryClient,
} from "@/test-support/query";

import { renderHook, waitFor } from "@testing-library/react";
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
import { useIssue } from "./useIssue";

const mockApiFetch = vi.mocked(apiFetch);

const SAMPLE_ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Sample",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

describe("useIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls GET /api/issues/{id}?vault={vault} and returns { issue, content }", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ issue: SAMPLE_ISSUE, content: "## body" }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useIssue("REEF-001", "reef-acme"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      issue: SAMPLE_ISSUE,
      content: "## body",
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001?vault=reef-acme",
    );
  });

  it("is disabled when id is empty", () => {
    const { result } = renderHook(() => useIssue("", "reef-acme"), {
      wrapper: createQueryWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("is disabled when vault is empty", () => {
    const { result } = renderHook(() => useIssue("REEF-001", ""), {
      wrapper: createQueryWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("surfaces 404 as isError", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Issue not found." }), {
        status: 404,
      }),
    );

    const { result } = renderHook(() => useIssue("REEF-999", "reef-acme"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Issue not found");
  });

  it("revalidates on mount even when the cached value is still fresh (REEF-227)", async () => {
    const queryClient = createTestQueryClient();
    // Seed a FRESH cache entry (inside the 30s staleTime window). Without
    // refetchOnMount:"consistently" this would be served with no network call; the
    // card would show this (possibly stale-vs-external) copy.
    queryClient.setQueryData(["issues", "detail", "reef-acme", "REEF-001"], {
      issue: SAMPLE_ISSUE,
      content: "cached body",
      commit_hash: "c1",
    });
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          issue: SAMPLE_ISSUE,
          content: "fresh body",
          commit_hash: "c2",
        }),
        { status: 200 },
      ),
    );

    const Wrapper = createQueryWrapper(queryClient);
    const { result } = renderHook(() => useIssue("REEF-001", "reef-acme"), {
      wrapper: Wrapper,
    });

    // Opening the card forces a revalidation despite the fresh cache, so the
    // editor converges on the latest workspace state.
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(result.current.data?.content).toBe("fresh body"),
    );
  });
});
