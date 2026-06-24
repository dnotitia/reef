"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-icon";
import { ArtifactMetadata, ReviewActions } from "@/features/ai/review";
import { useStatusLabels } from "@/i18n/fieldLabels";
import type { ActivityStatusChangeSuggestion, Status } from "@reef/core";
import { WORKFLOW_STATUS_OPTIONS } from "@reef/core/fields";
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
  onDismiss?: (statusChangeId: string) => void;
  onSaveTarget?: (statusChangeId: string, toStatus: Status) => Promise<void>;
  isApproving: boolean;
}) {
  const statusLabels = useStatusLabels();
  const { statusChange } = item;
  const proposedStatus = statusChange.proposal.update.patch.status ?? "done";
  const [isEditing, setIsEditing] = useState(false);
  const [toStatus, setToStatus] = useState<Status>(proposedStatus);
  const [isSaving, setIsSaving] = useState(false);

  const handleCancel = () => {
    setToStatus(proposedStatus);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!onSaveTarget) return;
    setIsSaving(true);
    try {
      await onSaveTarget(statusChange.id, toStatus);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      data-testid="activity-item-ai_status_change"
      className="rounded-md border border-ai-border bg-ai-subtle px-4 py-3"
    >
      <ActivityCardHeader
        badge="AI Status Change"
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
                aria-label="Target status"
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
            label: `${item.type} ${item.ref}`,
            url: githubActivityUrl({
              type: item.type,
              repo: item.repo,
              ref: item.ref,
            }),
            metadata: { repo: item.repo, actor: item.actor },
          }))}
          evidenceLabel={`${statusChange.evidence.length} commit${
            statusChange.evidence.length === 1 ? "" : "s"
          } / PR${statusChange.evidence.length === 1 ? "" : "s"}`}
        />
      </ActivityCardHeader>

      <div className="mt-3 flex items-center gap-2">
        {isEditing ? (
          <ReviewActions
            actions={[
              {
                id: "save",
                label: "Save",
                busy: isSaving,
                onClick: handleSave,
                testId: "status-change-save",
              },
              { id: "cancel", label: "Cancel", onClick: handleCancel },
            ]}
          />
        ) : (
          <ReviewActions
            actions={[
              {
                id: "approve",
                label: "Approve",
                busy: isApproving,
                busyLabel: "Updating...",
                onClick: () => onApprove?.(statusChange),
              },
              {
                id: "edit",
                label: "Edit",
                onClick: () => setIsEditing(true),
                testId: "status-change-edit",
              },
              {
                id: "dismiss",
                label: "Dismiss",
                onClick: () => onDismiss?.(statusChange.id),
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
