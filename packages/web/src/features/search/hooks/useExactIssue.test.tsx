import { createQueryWrapper } from "@/test-support/query";

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
import type { IssueListItem } from "@reef/core";
import { useExactIssue } from "./useExactIssue";

const mockApiFetch = vi.mocked(apiFetch);

const SAMPLE: IssueListItem = {
  id: "REEF-001",
  title: "Sample",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

describe("useExactIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the issue row for a hit", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: SAMPLE, content: "## body" }), {
        status: 200,
      }),
    );
    const { result } = renderHook(
      () => useExactIssue("REEF-001", "reef-acme"),
      {
        wrapper: createQueryWrapper(),
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SAMPLE);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001?vault=reef-acme",
    );
  });

  it("resolves to null (not an error) on 404 and does not retry", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Issue not found." }), {
        status: 404,
      }),
    );
    const { result } = renderHook(
      () => useExactIssue("REEF-999", "reef-acme"),
      {
        wrapper: createQueryWrapper(),
      },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });

  it("keys the cache by vault so another vault's hit is not reused", async () => {
    mockApiFetch.mockImplementation((url) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            issue: {
              ...SAMPLE,
              title: String(url).includes("vault=a") ? "A" : "B",
            },
            content: "",
          }),
          { status: 200 },
        ),
      ),
    );
    const wrapper = createQueryWrapper();
    const a = renderHook(() => useExactIssue("REEF-001", "a"), { wrapper });
    await waitFor(() => expect(a.result.current.data?.title).toBe("A"));
    const b = renderHook(() => useExactIssue("REEF-001", "b"), { wrapper });
    await waitFor(() => expect(b.result.current.data?.title).toBe("B"));
    // Distinct vaults → distinct cache entries → two fetches, no cross-vault reuse.
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["", "reef-acme"],
    ["REEF-001", ""],
  ])("is disabled for id=%j and vault=%j", (id, vault) => {
    const { result } = renderHook(() => useExactIssue(id, vault), {
      wrapper: createQueryWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });
});
