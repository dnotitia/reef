"use client";

import { apiFetch, throwHttpError } from "@/lib/apiClient";
import {
  NotificationRowSchema,
  type NotificationState,
  NotificationStateSchema,
  type Notification as ReefNotification,
} from "@reef/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const NOTIFICATIONS_QUERY_KEY = ["notifications"] as const;

const NOTIFICATION_LIST_LIMIT = 100;

async function fetchNotifications(
  vault: string,
  state: NotificationState,
): Promise<ReefNotification[]> {
  const params = new URLSearchParams({
    vault,
    state,
    limit: String(NOTIFICATION_LIST_LIMIT),
  });
  const response = await apiFetch(`/api/notifications?${params}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    await throwHttpError(
      response,
      `Failed to load notifications: ${response.status}`,
    );
  }
  const body = (await response.json()) as { notifications?: unknown };
  return NotificationRowSchema.array().parse(body.notifications ?? []);
}

function useNotificationListQuery(vault: string, state: NotificationState) {
  return useQuery({
    queryKey: [...NOTIFICATIONS_QUERY_KEY, vault, state],
    queryFn: () => fetchNotifications(vault, state),
    enabled: vault.length > 0,
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

/**
 * The sidebar badge is derived from the bounded unread list, not a count
 * endpoint. The server and query both stop at 100, preserving the contract
 * that 100 means "100 or more" for accessibility.
 */
export function useUnreadNotificationCount(vault: string): number {
  const query = useNotificationListQuery(vault, "unread");
  return query.data?.length ?? 0;
}

export interface InboxNotificationsResult {
  notifications: ReefNotification[];
  unreadCount: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}

export function useInboxNotifications(vault: string): InboxNotificationsResult {
  const unreadQuery = useNotificationListQuery(vault, "unread");
  const readQuery = useNotificationListQuery(vault, "read");

  const byKey = new Map<string, ReefNotification>();
  for (const notification of [
    ...(unreadQuery.data ?? []),
    ...(readQuery.data ?? []),
  ]) {
    byKey.set(notification.notification_key, notification);
  }
  const notifications = [...byKey.values()]
    .filter((notification) => notification.state !== "archived")
    .sort((left, right) => {
      const occurredOrder = right.occurred_at.localeCompare(left.occurred_at);
      return occurredOrder !== 0
        ? occurredOrder
        : right.id.localeCompare(left.id);
    });

  return {
    notifications,
    unreadCount: unreadQuery.data?.length ?? 0,
    isLoading: unreadQuery.isPending || readQuery.isPending,
    isError: unreadQuery.isError || readQuery.isError,
    refetch: async () => {
      await Promise.all([unreadQuery.refetch(), readQuery.refetch()]);
    },
  };
}

export function useUpdateNotificationState(vault: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      notificationKey,
      state,
    }: {
      notificationKey: string;
      state: NotificationState;
    }) => {
      const parsedState = NotificationStateSchema.parse(state);
      const response = await apiFetch(
        `/api/notifications/${encodeURIComponent(notificationKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault, state: parsedState }),
        },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to update notification: ${response.status}`,
        );
      }
      const body = (await response.json()) as { notification?: unknown };
      return NotificationRowSchema.parse(body.notification);
    },
    onSuccess: (updated) => {
      for (const state of ["unread", "read"] as const) {
        queryClient.setQueryData<ReefNotification[] | undefined>(
          [...NOTIFICATIONS_QUERY_KEY, vault, state],
          (current) => {
            const remaining = (current ?? []).filter(
              (notification) =>
                notification.notification_key !== updated.notification_key,
            );
            return updated.state === state
              ? [updated, ...remaining]
              : remaining;
          },
        );
      }
      void queryClient.invalidateQueries({
        queryKey: [...NOTIFICATIONS_QUERY_KEY, vault],
      });
    },
  });
}
