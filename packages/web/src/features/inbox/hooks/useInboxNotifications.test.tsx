import {
  createQueryWrapper,
  createTestQueryClient,
} from "@/test-support/query";
import { apiFetch } from "@/lib/apiClient";
import type { Notification } from "@reef/core";

import { act, renderHook, waitFor } from "@testing-library/react";
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
    issue_context: {
      availability: "available",
      title: `Title for REEF-${index + 1}`,
    },
    status_change_context: null,
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
    const queryClient = createTestQueryClient();
    const Wrapper = createQueryWrapper(queryClient);

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
      wrapper: createQueryWrapper(),
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
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("updates only the matching workspace copy after server success", async () => {
    const notificationKey = "same-key";
    const alpha = {
      ...makeNotification(0, "unread", "reef-alpha"),
      notification_key: notificationKey,
      event_type: "status_change",
      issue_context: {
        availability: "available" as const,
        title: "Alpha source title",
      },
      status_change_context: {
        availability: "available" as const,
        from: "todo" as const,
        to: "in_progress" as const,
      },
    };
    const zeta = {
      ...makeNotification(0, "unread", "reef-zeta"),
      notification_key: notificationKey,
      event_type: "status_change",
      issue_context: {
        availability: "available" as const,
        title: "Zeta source title",
      },
      status_change_context: {
        availability: "available" as const,
        from: "backlog" as const,
        to: "done" as const,
      },
    };
    const serverUpdatedNotification: Notification = {
      id: alpha.id,
      notification_key: notificationKey,
      recipient: "alice",
      reef_id: "REEF-001",
      source_type: "activity",
      source_ref: "event-1",
      event_type: "status_change",
      actor: "bob",
      occurred_at: alpha.occurred_at,
      state: "read",
      read_at: "2026-07-28T03:00:00.000Z",
      archived_at: null,
      payload: null,
      meta: null,
    };
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(personalNotificationsQueryKey("alice"), [
      alpha,
      zeta,
    ]);
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ notification: serverUpdatedNotification }),
        { status: 200 },
      ),
    );
    const Wrapper = createQueryWrapper(queryClient);
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
    const cachedNotifications = queryClient.getQueryData(
      personalNotificationsQueryKey("alice"),
    );
    expect(cachedNotifications).toEqual([
      {
        ...alpha,
        state: serverUpdatedNotification.state,
        read_at: serverUpdatedNotification.read_at,
        archived_at: serverUpdatedNotification.archived_at,
      },
      zeta,
    ]);
  });

  it("preserves a resource 403 as a permission-denied inbox error", async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "permission denied" }), {
        status: 403,
      }),
    );

    const { result } = renderHook(() => useInboxNotifications(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isError).toBe(true);
    expect(result.current.isPermissionDenied).toBe(true);
  });
});
