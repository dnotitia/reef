import { apiFetch } from "@/lib/apiClient";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
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

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useIssueSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    focusManager.setFocused(undefined);
  });

  it("uses a vault-and-issue scoped key and reads the effective state", async () => {
    mockApiFetch.mockResolvedValueOnce(
      Response.json({ state: "watching" }, { status: 200 }),
    );
    const queryClient = makeQueryClient();

    const { result } = renderHook(
      () => useIssueSubscription("REEF-001", "reef-e2e"),
      { wrapper: wrapper(queryClient) },
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
    const queryClient = makeQueryClient();

    const { result } = renderHook(
      () => useIssueSubscription("REEF-001", "reef-e2e"),
      { wrapper: wrapper(queryClient) },
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
