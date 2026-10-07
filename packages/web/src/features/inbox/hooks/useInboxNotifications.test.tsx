import { apiFetch } from "@/lib/apiClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  personalNotificationsQueryKey,
  useInboxNotifications,
  useUnreadNotificationCount,
  useUpdateNotificationState,
} from "./useInboxNotifications";

const mocks = vi.hoisted(() => ({
  currentUser: {
    data: { username: "alice" },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/features/auth/hooks/useCurrentUser", () => ({
  useCurrentUser: () => mocks.currentUser,
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function makeWrapper(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return { Wrapper, queryClient };
}

function makeNotification(
  index: number,
  state: "unread" | "read",
  workspace = "reef-acme",
) {
  const suffix = String(index + 1).padStart(12, "0");
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    notification_key: `notification:5:alice:8:activity:8:REEF-${index + 1}`,
    recipient: "alice",
    reef_id: `REEF-${String(index + 1).padStart(3, "0")}`,
    source_type: "activity",
    source_ref: `event-${index + 1}`,
    event_type: "comment_created",
    actor: "bob",
    occurred_at: `2026-07-28T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    state,
    read_at: state === "read" ? "2026-07-28T00:00:00.000Z" : null,
    archived_at: null,
    payload: null,
    meta: null,
    workspace,
  };
}

describe("useInboxNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentUser.data = { username: "alice" };
    mocks.currentUser.isPending = false;
    mocks.currentUser.isError = false;
  });

  it("loads one account-scoped response and preserves duplicate keys by workspace", async () => {
    const unread = makeNotification(0, "unread", "reef-alpha");
    const duplicateUnread = { ...unread, workspace: "reef-zeta" };
    const read = makeNotification(1, "read");
    read.occurred_at = "2026-07-27T00:00:00.000Z";
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ notifications: [unread, duplicateUnread, read] }),
        { status: 200 },
      ),
    );
    const { Wrapper, queryClient } = makeWrapper();

    const { result } = renderHook(() => useInboxNotifications(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.notifications.map((item) => item.workspace)).toEqual([
      "reef-alpha",
      "reef-zeta",
      "reef-acme",
    ]);
    expect(result.current.notifications[0]?.notification_key).toBe(
      result.current.notifications[1]?.notification_key,
    );
    expect(result.current.unreadCount).toBe(2);
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
    expect(mockedApiFetch).toHaveBeenCalledWith("/api/notifications", {
      cache: "no-store",
    });
    const cached = queryClient.getQueryCache().find({
      queryKey: personalNotificationsQueryKey("alice"),
    });
    expect(cached?.meta).toEqual({ persist: false });
  });

  it("treats exactly 100 unread rows as the capped 100-or-more value", async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          notifications: Array.from({ length: 100 }, (_, index) =>
            makeNotification(index, "unread"),
          ),
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: makeWrapper().Wrapper,
    });

    await waitFor(() => expect(result.current).toBe(100));
    expect(mockedApiFetch).toHaveBeenCalledWith("/api/notifications", {
      cache: "no-store",
    });
  });

  it("keeps the badge unknown when the full notification read fails", async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "source unavailable" }), {
        status: 503,
      }),
    );

    const { result } = renderHook(() => useUnreadNotificationCount(), {
      wrapper: makeWrapper().Wrapper,
    });

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("updates only the matching workspace copy after server success", async () => {
    const notificationKey = "same-key";
    const alpha = {
      ...makeNotification(0, "unread", "reef-alpha"),
      notification_key: notificationKey,
    };
    const zeta = {
      ...makeNotification(0, "unread", "reef-zeta"),
      notification_key: notificationKey,
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(personalNotificationsQueryKey("alice"), [
      alpha,
      zeta,
    ]);
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ notification: { ...alpha, state: "read" } }),
        { status: 200 },
      ),
    );
    const { Wrapper } = makeWrapper(queryClient);
    const { result } = renderHook(() => useUpdateNotificationState(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspace: "reef-alpha",
        notificationKey,
        state: "read",
      });
    });

    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/notifications/same-key",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ vault: "reef-alpha", state: "read" }),
      }),
    );
    expect(
      queryClient.getQueryData(personalNotificationsQueryKey("alice")),
    ).toEqual([{ ...alpha, state: "read" }, zeta]);
  });

  it("preserves a resource 403 as a permission-denied inbox error", async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "permission denied" }), {
        status: 403,
      }),
    );

    const { result } = renderHook(() => useInboxNotifications(), {
      wrapper: makeWrapper().Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.isPermissionDenied).toBe(true);
  });
});
