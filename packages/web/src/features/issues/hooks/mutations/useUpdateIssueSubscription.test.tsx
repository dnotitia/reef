import { createQueryWrapper } from "@/test-support/query";
import { apiFetch } from "@/lib/apiClient";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueSubscriptionKey } from "../queries/useIssueSubscription";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { useUpdateIssueSubscription } from "./useUpdateIssueSubscription";

const mockApiFetch = vi.mocked(apiFetch);

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useUpdateIssueSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("optimistically watches and reconciles with the returned server state", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    mockApiFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const queryClient = makeQueryClient();
    const key = issueSubscriptionKey("reef-e2e", "REEF-001");
    queryClient.setQueryData(key, "unwatched");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateIssueSubscription(), {
      wrapper: createQueryWrapper(queryClient),
    });

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.mutateAsync({
        issueId: "REEF-001",
        vault: "reef-e2e",
        action: "watch",
      });
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
      expect(queryClient.getQueryData(key)).toBe("watching");
    });
    expect(JSON.parse(mockApiFetch.mock.calls[0]?.[1]?.body as string)).toEqual(
      {
        action: "watch",
      },
    );

    await act(async () => {
      resolveResponse?.(Response.json({ state: "muted" }, { status: 200 }));
      await pending;
    });

    expect(queryClient.getQueryData(key)).toBe("muted");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: key,
      refetchType: "active",
    });
  });

  it("rolls a failed mute back and still refetches the server truth", async () => {
    let resolveResponse: (response: Response) => void = () => {};
    mockApiFetch.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const queryClient = makeQueryClient();
    const key = issueSubscriptionKey("reef-e2e", "REEF-001");
    queryClient.setQueryData(key, "watching");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateIssueSubscription(), {
      wrapper: createQueryWrapper(queryClient),
    });

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.mutateAsync({
        issueId: "REEF-001",
        vault: "reef-e2e",
        action: "mute",
      });
    });
    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
      expect(queryClient.getQueryData(key)).toBe("muted");
    });
    await act(async () => {
      resolveResponse(
        Response.json(
          { error: "Notification preference could not be changed." },
          { status: 503 },
        ),
      );
      await expect(pending).rejects.toThrow(
        "Notification preference could not be changed.",
      );
    });

    expect(queryClient.getQueryData(key)).toBe("watching");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: key,
      refetchType: "active",
    });
  });
});
