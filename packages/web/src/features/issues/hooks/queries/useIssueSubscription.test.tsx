import {
  createQueryWrapper,
  createTestQueryClient,
} from "@/test-support/query";
import { apiFetch } from "@/lib/apiClient";
import { focusManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import {
  issueSubscriptionKey,
  useIssueSubscription,
} from "./useIssueSubscription";

const mockApiFetch = vi.mocked(apiFetch);

describe("useIssueSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    focusManager.setFocused(undefined);
  });

  it("uses a vault-and-issue scoped key and reads the effective state", async () => {
    mockApiFetch.mockResolvedValueOnce(
      Response.json({ state: "watching" }, { status: 200 }),
    );
    const queryClient = createTestQueryClient();

    const { result } = renderHook(
      () => useIssueSubscription("REEF-001", "reef-e2e"),
      { wrapper: createQueryWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.data).toBe("watching"));
    expect(issueSubscriptionKey("reef-e2e", "REEF-001")).toEqual([
      "issues",
      "subscription",
      "reef-e2e",
      "REEF-001",
    ]);
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues/REEF-001/subscription?vault=reef-e2e",
    );
  });

  it("revalidates when the window regains focus", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        Response.json({ state: "unwatched" }, { status: 200 }),
      )
      .mockResolvedValueOnce(
        Response.json({ state: "muted" }, { status: 200 }),
      );
    const queryClient = createTestQueryClient();

    const { result } = renderHook(
      () => useIssueSubscription("REEF-001", "reef-e2e"),
      { wrapper: createQueryWrapper(queryClient) },
    );
    await waitFor(() => expect(result.current.data).toBe("unwatched"));

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(result.current.data).toBe("muted"));
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });
});
