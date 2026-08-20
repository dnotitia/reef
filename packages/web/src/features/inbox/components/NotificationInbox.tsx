"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { buildOpenIssueHref } from "@/features/issues/lib/issueHref";
import { commentTargetId } from "@/features/issues/lib/commentTarget";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { EmptyWorkspaceNotice } from "@/features/ui/components/EmptyWorkspaceNotice";
import { PageBody } from "@/features/ui/components/PageBody";
import { PageHeader } from "@/features/ui/components/PageHeader";
import { formatAbsoluteTime } from "@/lib/relativeTime";
import {
  ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE,
  type NotificationState,
  type Notification as ReefNotification,
} from "@reef/core";
import { Archive, Bell, MailOpen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  useInboxNotifications,
  useUpdateNotificationState,
} from "../hooks/useInboxNotifications";

const KNOWN_EVENT_TYPES = [
  "comment_created",
  "comment_updated",
  "status_change",
  "assignee_change",
  "priority_change",
  "planning_link",
  "issue_body_mentions_change",
  "impl_ref_linked",
  "labels_change",
  "relation_change",
  "estimate_change",
  "archived_change",
  "attachment_added",
  "attachment_removed",
  "start_date_change",
  "title_change",
  "due_date_change",
  "parent_change",
  "issue_type_change",
  "delivery_ready",
  "validation_proof_refreshed",
  "contract_amended",
  "issue_contract_updated",
] as const;

function notificationEventLabel(
  eventType: string,
  translate: (key: string) => string,
): string {
  if ((KNOWN_EVENT_TYPES as readonly string[]).includes(eventType)) {
    return translate(`event.${eventType}`);
  }
  return translate("notification");
}

function notificationIssueHref(
  vault: string,
  notification: Pick<
    ReefNotification,
    "reef_id" | "source_type" | "source_ref" | "event_type"
  >,
): string {
  const targetId =
    notification.source_type === "comment"
      ? commentTargetId(notification.source_ref)
      : notification.event_type === ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE
        ? "issue-description"
        : null;
  return `${buildOpenIssueHref(vault, notification.reef_id, new URLSearchParams())}#${targetId ?? "issue-activity"}`;
}

function NotificationItem({
  notification,
  vault,
  onActionError,
}: {
  notification: ReefNotification;
  vault: string;
  onActionError: (message: string | null) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("inbox");
  const translateInbox = t as unknown as (key: string) => string;
  const router = useRouter();
  const updateState = useUpdateNotificationState(vault);
  const [busy, setBusy] = useState(false);
  const stateLabels: Record<NotificationState, string> = {
    unread: t("state.unread"),
    read: t("state.read"),
    archived: t("state.archived"),
  };
  const eventLabel =
    notification.event_type === ACTIVITY_EVENT_ISSUE_BODY_MENTIONS_CHANGE
      ? t("issueBodyMention")
      : notificationEventLabel(notification.event_type, translateInbox);
  const issueHref = notificationIssueHref(vault, notification);

  async function updateStateAndRefresh(state: NotificationState) {
    setBusy(true);
    onActionError(null);
    try {
      await updateState.mutateAsync({
        notificationKey: notification.notification_key,
        state,
      });
      if (state === "archived") {
        toast.success(t("archiveSuccess", { issue: notification.reef_id }));
      }
    } catch {
      onActionError(t("actionError"));
    } finally {
      setBusy(false);
    }
  }

  async function openNotification() {
    if (notification.state === "unread") {
      setBusy(true);
      onActionError(null);
      try {
        await updateState.mutateAsync({
          notificationKey: notification.notification_key,
          state: "read",
        });
      } catch {
        setBusy(false);
        onActionError(t("actionError"));
        return;
      }
      setBusy(false);
    }
    router.push(issueHref);
  }

  return (
    <li
      data-testid="notification-item"
      data-notification-key={notification.notification_key}
      data-state={notification.state}
      className="[content-visibility:auto] [contain-intrinsic-size:0_68px] border-b border-border-subtle last:border-b-0"
    >
      <div
        className={
          notification.state === "unread"
            ? "flex min-w-0 items-start gap-3 bg-brand-fill/5 px-4 py-3"
            : "flex min-w-0 items-start gap-3 px-4 py-3"
        }
      >
        <span
          aria-hidden="true"
          className={
            notification.state === "unread"
              ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-fill"
              : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border"
          }
        />
        <button
          type="button"
          data-testid="notification-open"
          onClick={() => void openNotification()}
          disabled={busy}
          aria-busy={busy}
          className="min-w-0 flex-1 touch-manipulation rounded-md text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/40"
          aria-label={t("openNotification", { issue: notification.reef_id })}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold text-foreground">
              {eventLabel}
            </span>
            <span className="text-[12px] text-muted-foreground" translate="no">
              {notification.actor}
            </span>
            <span
              className="rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              translate="no"
            >
              {notification.reef_id}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <time
              dateTime={notification.occurred_at}
              title={formatAbsoluteTime(notification.occurred_at, locale)}
              className="tabular-nums"
            >
              {formatAbsoluteTime(notification.occurred_at, locale) ||
                notification.occurred_at}
            </time>
            <span aria-hidden="true">·</span>
            <span>{stateLabels[notification.state]}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {notification.state === "read" && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              hitTarget="compact"
              className="touch-manipulation"
              disabled={busy}
              busy={busy}
              onClick={() => void updateStateAndRefresh("unread")}
              aria-label={t("markUnreadFor", { issue: notification.reef_id })}
              title={t("markUnread")}
            >
              <MailOpen className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            hitTarget="compact"
            className="touch-manipulation"
            disabled={busy}
            busy={busy}
            onClick={() => void updateStateAndRefresh("archived")}
            aria-label={t("archiveFor", { issue: notification.reef_id })}
            title={t("archive")}
          >
            <Archive className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </li>
  );
}

export function NotificationInboxSkeleton() {
  const t = useTranslations("inbox");
  return (
    <div
      data-testid="notification-inbox-loading"
      className="mx-auto w-full max-w-2xl"
    >
      <output className="sr-only">{t("loading")}</output>
      <div
        className="overflow-hidden rounded-lg border border-border-subtle"
        aria-hidden="true"
      >
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="flex items-start gap-3 border-b border-border-subtle px-4 py-4 last:border-b-0"
          >
            <Skeleton tone="secondary" className="mt-1 h-2 w-2 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton tone="secondary" className="h-4 w-2/3" />
              <Skeleton tone="secondary" className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationInboxContent({ vault }: { vault: string }) {
  const t = useTranslations("inbox");
  const { notifications, isLoading, isError, refetch } =
    useInboxNotifications(vault);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const retryNotifications = async () => {
    setIsRetrying(true);
    try {
      await refetch();
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) return <NotificationInboxSkeleton />;

  if (isError) {
    return (
      <div
        role="alert"
        data-testid="notification-inbox-error"
        className="mx-auto w-full max-w-2xl rounded-lg border border-dashed border-destructive-focus/40 bg-destructive-fill/5 px-6 py-12 text-center"
      >
        <Bell
          className="mx-auto mb-3 h-5 w-5 text-destructive-text"
          aria-hidden="true"
        />
        <h2 className="text-pretty text-sm font-semibold text-foreground">
          {t("errorTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("errorDescription")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void retryNotifications()}
          busy={isRetrying}
          aria-label={t("retry")}
        >
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="notification-inbox">
      {actionError && (
        <div
          role="alert"
          aria-live="polite"
          className="mx-auto w-full max-w-2xl rounded-md border border-destructive-focus/40 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text"
        >
          {actionError}
        </div>
      )}
      {notifications.length === 0 ? (
        <EmptyState
          data-testid="notification-inbox-empty"
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul
          aria-label={t("listLabel")}
          data-testid="notification-inbox-list"
          className="mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-border-subtle bg-surface-subtle"
        >
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.notification_key}
              notification={notification}
              vault={vault}
              onActionError={setActionError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function NotificationInboxPage() {
  const { vault, isLoading: vaultLoading } = useActiveVault();
  const nav = useTranslations("nav");

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={nav("inbox")} description={vault || undefined} />
      {!vault && !vaultLoading ? (
        <EmptyWorkspaceNotice />
      ) : (
        <PageBody width="full">
          <NotificationInboxContent vault={vault} />
        </PageBody>
      )}
    </div>
  );
}
