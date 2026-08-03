import { apiFetch } from "@/lib/apiClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useInboxNotifications,
  useUnreadNotificationCount,
} from "./useInboxNotifications";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function makeNotification(index: number, state: "unread" | "read") {
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
    occurred_at: `2026-07-${String(28 - Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    state,
    read_at: state === "read" ? "2026-07-28T00:00:00.000Z" : null,
    archived_at: null,
  };
}

describe("useInboxNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads bounded unread/read lists, merges them by occurred time, and never calls a count endpoint", async () => {
    const unread = makeNotification(0, "unread");
    const read = makeNotification(1, "read");
    read.occurred_at = "2026-07-27T00:00:00.000Z";
    mockedApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ notifications: [unread] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ notifications: [read] }), {
          status: 200,
        }),
      );

    const { result } = renderHook(() => useInboxNotifications("reef-acme"), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.notifications.map((item) => item.state)).toEqual([
      "unread",
      "read",
    ]);
    expect(result.current.unreadCount).toBe(1);
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
    expect(mockedApiFetch.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/notifications?vault=reef-acme&state=unread&limit=100",
      "/api/notifications?vault=reef-acme&state=read&limit=100",
    ]);
    expect(
      mockedApiFetch.mock.calls.some(([url]) => String(url).includes("/count")),
    ).toBe(false);
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

    const { result } = renderHook(
      () => useUnreadNotificationCount("reef-acme"),
      { wrapper: makeWrapper() },
    );

    await waitFor(() => expect(result.current).toBe(100));
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/notifications?vault=reef-acme&state=unread&limit=100",
      { cache: "no-store" },
    );
  });
});
