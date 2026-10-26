import {
  createQueryWrapper,
  createTestQueryClient,
} from "@/test-support/query";
import { apiFetch } from "@/lib/apiClient";
import type { Notification } from "@reef/core";
import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  personalNotificationsQueryKey,
  useInboxNotifications,
  useMarkAllPersonalNotificationsRead,
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares one account tab stream across the badge and Inbox and refreshes the same cache", async () => {
    const unread = makeNotification(3, "unread");
    const responses = [[], [], [unread]];
    mockedApiFetch.mockImplementation(async (input) => {
      if (input !== "/api/notifications") {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      return new Response(
        JSON.stringify({ notifications: responses.shift() ?? [unread] }),
        { status: 200 },
      );
    });

    class TestEventSource {
      static instances: TestEventSource[] = [];
      readonly listeners = new Map<string, Set<EventListener>>();
      readonly close = vi.fn();

      constructor(readonly url: string) {
        TestEventSource.instances.push(this);
      }

      addEventListener(type: string, listener: EventListener): void {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      emit(type: string): void {
        const event = new MessageEvent(type, { data: "{}" });
        for (const listener of this.listeners.get(type) ?? []) {
          listener(event);
        }
      }
    }
    vi.stubGlobal("EventSource", TestEventSource);

    const queryClient = createTestQueryClient();
    const { result, unmount } = renderHook(
      () => ({
        badge: useUnreadNotificationCount(),
        inbox: useInboxNotifications(),
      }),
      { wrapper: createQueryWrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.badge).toBe(0));
    await waitFor(() => expect(TestEventSource.instances).toHaveLength(1));
    const source = TestEventSource.instances[0];
    expect(source?.url).toBe("/api/notifications/events");

    await act(async () => source?.emit("ready"));
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(2));

    await act(async () => source?.emit("notifications_changed"));
    await waitFor(() => {
      expect(result.current.badge).toBe(1);
      expect(result.current.inbox.notifications).toEqual([unread]);
    });
    expect(mockedApiFetch).toHaveBeenCalledTimes(3);
    expect(source?.close).not.toHaveBeenCalled();
    unmount();
    expect(source?.close).toHaveBeenCalledTimes(1);
  });

  it("queues a follow-up refresh when more change signals arrive during a fetch", async () => {
    let requestCount = 0;
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let releaseHeldRequest: (() => void) | undefined;
    const heldRequest = new Promise<void>((resolve) => {
      releaseHeldRequest = resolve;
    });
    mockedApiFetch.mockImplementation(async () => {
      requestCount += 1;
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      if (requestCount === 2) await heldRequest;
      activeRequests -= 1;
      return new Response(JSON.stringify({ notifications: [] }), {
        status: 200,
      });
    });

    class TestEventSource {
      static instances: TestEventSource[] = [];
      readonly listeners = new Map<string, Set<EventListener>>();

      constructor(readonly url: string) {
        TestEventSource.instances.push(this);
      }

      addEventListener(type: string, listener: EventListener): void {
        const listeners = this.listeners.get(type) ?? new Set<EventListener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      close(): void {}

      emit(type: string): void {
        const event = new MessageEvent(type, { data: "{}" });
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }
    vi.stubGlobal("EventSource", TestEventSource);

    const { result } = renderHook(() => useInboxNotifications(), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(TestEventSource.instances).toHaveLength(1));
    const source = TestEventSource.instances[0];

    await act(async () => source?.emit("ready"));
    await waitFor(() => expect(requestCount).toBe(2));
    await act(async () => {
      source?.emit("notifications_changed");
      source?.emit("notifications_changed");
    });
    expect(requestCount).toBe(2);
    expect(maxActiveRequests).toBe(1);

    await act(async () => releaseHeldRequest?.());
    await waitFor(() => expect(requestCount).toBe(3));
    await waitFor(() => expect(activeRequests).toBe(0));
    expect(maxActiveRequests).toBe(1);
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
      signal: expect.any(AbortSignal),
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
      signal: expect.any(AbortSignal),
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

  it("applies saved bulk results by workspace identity and retries only unresolved targets", async () => {
    const alpha = makeNotification(0, "unread", "reef-alpha");
    const zeta = { ...alpha, workspace: "reef-zeta" };
    const targets = [
      {
        workspace: "reef-alpha",
        notification_key: alpha.notification_key,
      },
      {
        workspace: "reef-zeta",
        notification_key: zeta.notification_key,
      },
    ];
    const readAt = "2026-10-15T14:00:00.000Z";
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(personalNotificationsQueryKey("alice"), [
      alpha,
      zeta,
    ]);
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            targets,
            completed: [
              {
                ...targets[0],
                state: "read",
                read_at: readAt,
              },
            ],
            unresolved: [targets[1]],
          },
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useMarkAllPersonalNotificationsRead(), {
      wrapper: createQueryWrapper(queryClient),
    });

    let firstResult: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      firstResult = await result.current.mutateAsync({});
    });

    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      1,
      "/api/notifications/read-all",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(
      queryClient.getQueryData(personalNotificationsQueryKey("alice")),
    ).toEqual([{ ...alpha, state: "read", read_at: readAt }, zeta]);

    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: {
            targets: [targets[1]],
            completed: [
              {
                ...targets[1],
                state: "read",
                read_at: "2026-10-15T14:01:00.000Z",
              },
            ],
            unresolved: [],
          },
        }),
        { status: 200 },
      ),
    );

    await act(async () => {
      await result.current.mutateAsync({ targets: firstResult.unresolved });
    });

    expect(mockedApiFetch).toHaveBeenNthCalledWith(
      2,
      "/api/notifications/read-all",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ targets: [targets[1]] }),
      }),
    );
    expect(
      queryClient.getQueryData(personalNotificationsQueryKey("alice")),
    ).toEqual([
      { ...alpha, state: "read", read_at: readAt },
      {
        ...zeta,
        state: "read",
        read_at: "2026-10-15T14:01:00.000Z",
      },
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

  it("keeps a delayed query result in the account generation that started it", async () => {
    const aliceNotification = makeNotification(0, "unread");
    const bobNotification = {
      ...makeNotification(1, "unread"),
      recipient: "bob",
    };
    let resolveAlice: ((response: Response) => void) | undefined;
    let requestCount = 0;
    mockedApiFetch.mockImplementation(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return await new Promise<Response>((resolve) => {
          resolveAlice = resolve;
        });
      }
      return new Response(
        JSON.stringify({ notifications: [bobNotification] }),
        { status: 200 },
      );
    });

    const queryClient = createTestQueryClient();
    const { result, rerender } = renderHook(() => useInboxNotifications(), {
      wrapper: createQueryWrapper(queryClient),
    });
    await waitFor(() => expect(requestCount).toBe(1));
    const aliceSignal = mockedApiFetch.mock.calls[0]?.[1]?.signal;

    act(() => {
      mocks.currentUser.data = { username: "bob" };
      rerender();
    });
    await waitFor(() =>
      expect(result.current.notifications[0]?.recipient).toBe("bob"),
    );
    await act(async () => {
      resolveAlice?.(
        new Response(JSON.stringify({ notifications: [aliceNotification] }), {
          status: 200,
        }),
      );
      await Promise.resolve();
    });

    expect(aliceSignal?.aborted).toBe(true);
    expect(result.current.notifications).toEqual([bobNotification]);
    expect(
      queryClient.getQueryData(personalNotificationsQueryKey("bob")),
    ).toEqual([bobNotification]);
  });

  it("pauses the shared stream while hidden or offline and resets it on account change", async () => {
    const visibilityDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    const onlineDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "onLine",
    );
    const setVisibility = (value: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value,
      });
    };
    const setOnline = (value: boolean) => {
      Object.defineProperty(navigator, "onLine", {
        configurable: true,
        value,
      });
    };
    class TestEventSource {
      static instances: TestEventSource[] = [];
      readonly close = vi.fn();

      constructor(readonly url: string) {
        TestEventSource.instances.push(this);
      }

      addEventListener(): void {}
    }
    vi.stubGlobal("EventSource", TestEventSource);
    mockedApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ notifications: [] }), { status: 200 }),
    );
    setVisibility("hidden");
    setOnline(true);

    const { rerender, unmount } = renderHook(() => useInboxNotifications(), {
      wrapper: createQueryWrapper(),
    });
    try {
      await waitFor(() => expect(mockedApiFetch).toHaveBeenCalled());
      expect(TestEventSource.instances).toHaveLength(0);

      act(() => {
        setVisibility("visible");
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await waitFor(() => expect(TestEventSource.instances).toHaveLength(1));
      const visibleSource = TestEventSource.instances[0];

      act(() => {
        setOnline(false);
        window.dispatchEvent(new Event("offline"));
      });
      expect(visibleSource?.close).toHaveBeenCalledOnce();

      act(() => {
        setOnline(true);
        window.dispatchEvent(new Event("online"));
      });
      await waitFor(() => expect(TestEventSource.instances).toHaveLength(2));
      const onlineSource = TestEventSource.instances[1];

      act(() => {
        mocks.currentUser.data = { username: "bob" };
        window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
        rerender();
      });
      await waitFor(() => expect(TestEventSource.instances).toHaveLength(3));
      expect(onlineSource?.close).toHaveBeenCalledOnce();

      unmount();
      expect(TestEventSource.instances[2]?.close).toHaveBeenCalledOnce();
    } finally {
      unmount();
      if (visibilityDescriptor) {
        Object.defineProperty(
          document,
          "visibilityState",
          visibilityDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
      if (onlineDescriptor) {
        Object.defineProperty(navigator, "onLine", onlineDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "onLine");
      }
    }
  });

  it("does not apply an individual mutation result to the account that replaced its caller", async () => {
    const aliceNotification = {
      ...makeNotification(0, "unread", "reef-alpha"),
      notification_key: "shared-key",
    };
    const bobNotification = {
      ...aliceNotification,
      recipient: "bob",
      state: "unread" as const,
      read_at: null,
    };
    const aliceUpdated: Notification = {
      id: aliceNotification.id,
      notification_key: aliceNotification.notification_key,
      recipient: "alice",
      reef_id: aliceNotification.reef_id,
      source_type: "activity",
      source_ref: "event-1",
      event_type: "comment_created",
      actor: "bob",
      occurred_at: aliceNotification.occurred_at,
      state: "read",
      read_at: "2026-10-26T03:00:00.000Z",
      archived_at: null,
      payload: null,
      meta: null,
    };
    let resolveMutation: ((response: Response) => void) | undefined;
    mockedApiFetch.mockImplementation(async (input) => {
      if (input !== "/api/notifications/shared-key") {
        throw new Error(`Unexpected request: ${String(input)}`);
      }
      return await new Promise<Response>((resolve) => {
        resolveMutation = resolve;
      });
    });

    const queryClient = createTestQueryClient();
    queryClient.setQueryData(personalNotificationsQueryKey("alice"), [
      aliceNotification,
    ]);
    queryClient.setQueryData(personalNotificationsQueryKey("bob"), [
      bobNotification,
    ]);
    const { result, rerender } = renderHook(
      () => useUpdateNotificationState(),
      { wrapper: createQueryWrapper(queryClient) },
    );
    let mutationPromise: Promise<Notification> | undefined;
    act(() => {
      mutationPromise = result.current.mutateAsync({
        workspace: "reef-alpha",
        notificationKey: "shared-key",
        state: "read",
      });
    });
    await waitFor(() => expect(resolveMutation).toBeDefined());

    act(() => {
      mocks.currentUser.data = { username: "bob" };
      rerender();
    });
    await act(async () => {
      resolveMutation?.(
        new Response(JSON.stringify({ notification: aliceUpdated }), {
          status: 200,
        }),
      );
      await mutationPromise;
    });

    expect(
      queryClient.getQueryData(personalNotificationsQueryKey("bob")),
    ).toEqual([bobNotification]);
  });
});
