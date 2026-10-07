"use client";

import { useCurrentUser } from "@/features/auth/hooks/useCurrentUser";
import { apiFetch, throwHttpError, type HttpError } from "@/lib/apiClient";
import {
  NotificationRowSchema,
  NotificationStateSchema,
  PersonalNotificationSchema,
  type NotificationState,
  type PersonalNotification,
} from "@reef/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const PERSONAL_NOTIFICATIONS_QUERY_KEY = ["notifications", "personal"] as const;
const NOTIFICATION_LIMIT_PER_STATE = 100;

export function personalNotificationsQueryKey(login: string) {
  return [...PERSONAL_NOTIFICATIONS_QUERY_KEY, login] as const;
}

function hasHttpStatus(error: unknown, status: number): error is HttpError {
  return (
    error instanceof Error &&
    typeof (error as Partial<HttpError>).status === "number" &&
    (error as Partial<HttpError>).status === status
  );
}

function notificationIdentity(notification: PersonalNotification): string {
  return `${notification.workspace}\0${notification.notification_key}`;
}

function compareNotifications(
  left: PersonalNotification,
  right: PersonalNotification,
): number {
  const timeOrder =
    Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
  if (timeOrder !== 0) return timeOrder;
  if (left.workspace !== right.workspace) {
    return left.workspace < right.workspace ? -1 : 1;
  }
  return left.id > right.id ? -1 : left.id < right.id ? 1 : 0;
}

function boundedVisibleList(
  notifications: PersonalNotification[],
): PersonalNotification[] {
  const unread = notifications
    .filter((notification) => notification.state === "unread")
    .sort(compareNotifications)
    .slice(0, NOTIFICATION_LIMIT_PER_STATE);
  const read = notifications
    .filter((notification) => notification.state === "read")
    .sort(compareNotifications)
    .slice(0, NOTIFICATION_LIMIT_PER_STATE);
  return [...unread, ...read].sort(compareNotifications);
}

async function fetchPersonalNotifications(): Promise<PersonalNotification[]> {
  const response = await apiFetch("/api/notifications", { cache: "no-store" });
  if (!response.ok) {
    await throwHttpError(
      response,
      `Failed to load notifications: ${response.status}`,
    );
  }
  const body = (await response.json()) as { notifications?: unknown };
  return PersonalNotificationSchema.array().parse(body.notifications ?? []);
}

function usePersonalNotificationsQuery() {
  const currentUser = useCurrentUser();
  const login = currentUser.data?.username?.trim() || null;
  const query = useQuery({
    queryKey: personalNotificationsQueryKey(login ?? "anonymous"),
    queryFn: fetchPersonalNotifications,
    enabled: Boolean(login),
    staleTime: 15_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
    meta: { persist: false },
  });
  return { currentUser, login, query };
}

/** The badge stays unknown until the full account-wide read succeeds. */
export function useUnreadNotificationCount(): number | null {
  const { currentUser, login, query } = usePersonalNotificationsQuery();
  if (
    currentUser.isPending ||
    currentUser.isError ||
    !login ||
    query.isPending ||
    query.isError ||
    !query.data
  ) {
    return null;
  }
  return query.data.filter((notification) => notification.state === "unread")
    .length;
}

export interface InboxNotificationsResult {
  notifications: PersonalNotification[];
  unreadCount: number | null;
  isLoading: boolean;
  isError: boolean;
  isPermissionDenied: boolean;
  refetch: () => Promise<void>;
}

export function useInboxNotifications(): InboxNotificationsResult {
  const { currentUser, login, query } = usePersonalNotificationsQuery();
  const notifications = query.data ?? [];
  const isLoading =
    currentUser.isPending || (Boolean(login) && query.isPending);

  return {
    notifications,
    unreadCount:
      query.data?.filter((notification) => notification.state === "unread")
        .length ?? null,
    isLoading,
    isError: currentUser.isError || (Boolean(login) && query.isError),
    isPermissionDenied: hasHttpStatus(query.error, 403),
    refetch: async () => {
      if (login) await query.refetch();
      else await currentUser.refetch();
    },
  };
}

export function useUpdateNotificationState() {
  const queryClient = useQueryClient();
  const currentUser = useCurrentUser();
  const login = currentUser.data?.username?.trim() || null;
  return useMutation({
    mutationFn: async ({
      workspace,
      notificationKey,
      state,
    }: {
      workspace: string;
      notificationKey: string;
      state: NotificationState;
    }): Promise<PersonalNotification> => {
      const parsedState = NotificationStateSchema.parse(state);
      const response = await apiFetch(
        `/api/notifications/${encodeURIComponent(notificationKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vault: workspace, state: parsedState }),
        },
      );
      if (!response.ok) {
        await throwHttpError(
          response,
          `Failed to update notification: ${response.status}`,
        );
      }
      const body = (await response.json()) as { notification?: unknown };
      return PersonalNotificationSchema.parse({
        ...NotificationRowSchema.parse(body.notification),
        workspace,
      });
    },
    onSuccess: (updated, variables) => {
      if (!login) return;
      const queryKey = personalNotificationsQueryKey(login);
      queryClient.setQueryData<PersonalNotification[] | undefined>(
        queryKey,
        (current) => {
          if (!current) return current;
          const identity = `${variables.workspace}\0${variables.notificationKey}`;
          const remaining = current.filter(
            (notification) => notificationIdentity(notification) !== identity,
          );
          if (updated.state !== "archived") remaining.push(updated);
          return boundedVisibleList(remaining);
        },
      );
      void queryClient.invalidateQueries({ queryKey });
    },
  });
}
