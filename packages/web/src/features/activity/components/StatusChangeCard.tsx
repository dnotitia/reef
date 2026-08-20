"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-icon";
import { ArtifactMetadata, ReviewActions } from "@/features/ai/review";
import { useStatusLabels } from "@/i18n/fieldLabels";
import type { ActivityStatusChangeSuggestion, Status } from "@reef/core";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { githubActivityUrl } from "../lib/activityLinks";
import type { ActivityFeedItem } from "../types";
import { ActivityCardHeader } from "./ActivityCardHeader";

// Valid edited targets for an AI status-change suggestion: workflow statuses
// excluding `closed`. `backlog` is already absent from WORKFLOW_STATUS_OPTIONS,
// and both are non-forward / final targets the approval guard would reject
// (REEF-109).
const STATUS_CHANGE_TARGETS = WORKFLOW_STATUS_OPTIONS.filter(
  (status) => status !== "closed",
);

export function StatusChangeCard({
  item,
  onApprove,
  onDismiss,
  onSaveTarget,
  isApproving,
}: {
  item: Extract<ActivityFeedItem, { type: "ai_status_change" }>;
  onApprove?: (statusChange: ActivityStatusChangeSuggestion) => Promise<void>;
  onDismiss?: (statusChangeId: string) => Promise<void>;
  onSaveTarget?: (statusChangeId: string, toStatus: Status) => Promise<void>;
  isApproving: boolean;
}) {
  const statusLabels = useStatusLabels();
  const t = useTranslations("activity");
  const tAi = useTranslations("ai");
  const common = useTranslations("common");
  const { statusChange } = item;
  const proposedStatus = statusChange.proposal.update.patch.status ?? "done";
  const [isEditing, setIsEditing] = useState(false);
  const [toStatus, setToStatus] = useState<Status>(proposedStatus);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "approve" | "dismiss" | "save" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<
    "approve" | "dismiss" | "save" | null
  >(null);

  const handleCancel = () => {
    setToStatus(proposedStatus);
    setIsEditing(false);
    setActionError(null);
    setFailedAction(null);
  };

  const runAction = async (
    action: "approve" | "dismiss" | "save",
    operation: () => Promise<void>,
    errorMessage: string,
  ) => {
    if (pendingAction) return;
    setPendingAction(action);
    setActionError(null);
    setFailedAction(null);
    try {
      await operation();
    } catch {
      setActionError(errorMessage);
      setFailedAction(action);
    } finally {
      setPendingAction(null);
    }
  };

  const handleApprove = () =>
    void runAction(
      "approve",
      async () => {
        if (onApprove) await onApprove(statusChange);
      },
      t("statusApproveError"),
    );

  const handleDismiss = () =>
    void runAction(
      "dismiss",
      async () => {
        if (onDismiss) await onDismiss(statusChange.id);
      },
      t("statusDismissError"),
    );

  const handleSave = () => {
    if (!onSaveTarget) return;
    void runAction(
      "save",
      async () => {
        setIsSaving(true);
        try {
          await onSaveTarget(statusChange.id, toStatus);
          setIsEditing(false);
        } finally {
          setIsSaving(false);
        }
      },
      t("statusSaveError"),
    );
  };

  const retryFailedAction = () => {
    if (failedAction === "approve") handleApprove();
    if (failedAction === "dismiss") handleDismiss();
    if (failedAction === "save") handleSave();
  };

  return (
    <div
      data-testid="activity-item-ai_status_change"
      className="rounded-md border border-ai-border bg-ai-subtle px-4 py-3"
    >
      <ActivityCardHeader
        badge={tAi("badgeStatusChange")}
        timestamp={item.timestamp}
        issueId={item.issueId}
        issueTitle={item.issueTitle}
      >
        <div
          className="mt-1 flex items-center gap-2 text-sm"
          data-testid="status-change-transition"
        >
          <StatusBadge status={statusChange.from_status} size={14} />
          <span aria-hidden className="text-muted-foreground">
            →
          </span>
          {isEditing ? (
            <Select
              value={toStatus}
              onValueChange={(value) => setToStatus(value as Status)}
            >
              <SelectTrigger
                aria-label={t("targetStatus")}
                data-testid="status-change-target"
                className="h-7 w-40"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_CHANGE_TARGETS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {statusLabels[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StatusBadge status={proposedStatus} size={14} />
          )}
        </div>
        <p className="mt-2 text-sm text-foreground whitespace-pre-wrap">
          {statusChange.rationale}
        </p>
        <ArtifactMetadata
          className="mt-2"
          confidence={statusChange.confidence}
          evidence={statusChange.evidence.map((item) => ({
            type: item.type,
            ref: item.ref,
            label: t("evidenceRef", {
              kind:
                item.type === "pr"
                  ? t("evidencePullRequest")
                  : t("evidenceCommit"),
              ref: item.ref,
            }),
            url: githubActivityUrl({
              type: item.type,
              repo: item.repo,
              ref: item.ref,
            }),
            metadata: { repo: item.repo, actor: item.actor },
          }))}
          evidenceLabel={t("evidenceSummary", {
            commits: statusChange.evidence.filter((e) => e.type === "commit")
              .length,
            pullRequests: statusChange.evidence.filter((e) => e.type === "pr")
              .length,
          })}
        />
      </ActivityCardHeader>

      {actionError && (
        <div
          role="alert"
          data-testid="activity-status-action-error"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text"
        >
          <span>{actionError}</span>
          {failedAction && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryFailedAction}
              disabled={pendingAction !== null}
            >
              {common("retry")}
            </Button>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {isEditing ? (
          <ReviewActions
            actions={[
              {
                id: "save",
                label: common("save"),
                busy: isSaving || pendingAction === "save",
                disabled: pendingAction !== null && pendingAction !== "save",
                onClick: handleSave,
                testId: "status-change-save",
              },
              {
                id: "cancel",
                label: common("cancel"),
                disabled: pendingAction !== null,
                onClick: handleCancel,
              },
            ]}
          />
        ) : (
          <ReviewActions
            actions={[
              {
                id: "approve",
                label: tAi("approve"),
                busy: isApproving || pendingAction === "approve",
                busyLabel: tAi("updating"),
                disabled: pendingAction !== null && pendingAction !== "approve",
                onClick: handleApprove,
              },
              {
                id: "edit",
                label: common("edit"),
                disabled: isApproving || pendingAction !== null,
                onClick: () => setIsEditing(true),
                testId: "status-change-edit",
              },
              {
                id: "dismiss",
                label: tAi("dismiss"),
                busy: pendingAction === "dismiss",
                busyLabel: tAi("dismissing"),
                disabled:
                  isApproving ||
                  (pendingAction !== null && pendingAction !== "dismiss"),
                onClick: handleDismiss,
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
