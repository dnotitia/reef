"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import {
  kanbanToastId,
  notifyRetryableError,
} from "@/components/ui/toastFeedback";
import { useUpdateIssue } from "@/features/issues/hooks/mutations/useUpdateIssue";
import { buildStatusPatch } from "@/features/issues/lib/statusPatch";
import { useFlashStore } from "@/features/issues/stores/useFlashStore";
import {
  type IssueKeyboardScope,
  useIssueKeyboardStore,
} from "@/features/issues/stores/useIssueKeyboardStore";
import {
  useEnrichmentEmptyLabels,
  useFieldNameLabels,
} from "@/i18n/fieldLabels";
import { cn } from "@/lib/utils";
import type {
  ClosedReason,
  IssueListItem,
  IssueUpdatePatch,
  Priority,
  Status,
} from "@reef/core";
import {
  NO_SELECTION,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
} from "@reef/core/fields";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { CloseIssueDialog } from "../detail/CloseIssueDialog";

interface IssueQuickEditAnchorProps {
  scope: IssueKeyboardScope;
  issue: IssueListItem;
  vault: string;
  className?: string;
}

const renderStatusOption = (status: Status) => <StatusBadge status={status} />;
const renderPriorityOption = (priority: Priority) => (
  <PriorityBadge priority={priority} />
);

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function IssueQuickEditAnchor({
  scope,
  issue,
  vault,
  className,
}: IssueQuickEditAnchorProps) {
  const request = useIssueKeyboardStore((state) => state.quickEditRequest);
  const closeQuickEdit = useIssueKeyboardStore((state) => state.closeQuickEdit);
  const mutation = useUpdateIssue();
  const flashIssue = useFlashStore((state) => state.flashIssue);
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const common = useTranslations("common");
  const board = useTranslations("board");
  const [pendingClose, setPendingClose] = useState(false);

  const field =
    request?.scope === scope && request.issueId === issue.id
      ? request.field
      : null;

  function commitPatch(patch: IssueUpdatePatch) {
    mutation.mutateAsync({ id: issue.id, vault, patch }).then(
      () => {
        toast.dismiss(kanbanToastId(issue.id));
        flashIssue(issue.id);
      },
      (err: unknown) => {
        notifyRetryableError({
          id: kanbanToastId(issue.id),
          title:
            err instanceof Error && err.message
              ? err.message
              : board("updateErrorTitle"),
          description: board("updateErrorDescription"),
          onRetry: () => commitPatch(patch),
        });
      },
    );
  }

  function closeOpenField(open: boolean) {
    if (!open) closeQuickEdit();
  }

  function commitStatus(next: Status) {
    if (next === issue.status) {
      closeQuickEdit();
      return;
    }
    if (next === "closed" && issue.status !== "closed") {
      closeQuickEdit();
      setPendingClose(true);
      return;
    }
    closeQuickEdit();
    commitPatch(buildStatusPatch(issue, next));
  }

  function confirmClose(reason: ClosedReason) {
    setPendingClose(false);
    commitPatch(buildStatusPatch(issue, "closed", undefined, reason));
  }

  const anchor =
    field === null ? null : (
      <div
        className={cn(
          "absolute left-2 top-1/2 z-30 w-56 -translate-y-1/2",
          className,
        )}
        data-testid="issue-quick-edit-anchor"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {field === "status" && (
          <EnumSelectField
            value={issue.status}
            onValueChange={(value) => commitStatus(value as Status)}
            options={STATUS_OPTIONS}
            renderItem={renderStatusOption}
            placeholder={fieldNames.status}
            testId="issue-quick-edit-status"
            open
            onOpenChange={closeOpenField}
            disabled={mutation.isPending}
            triggerClassName="bg-popover shadow-lg shadow-foreground/10"
          />
        )}

        {field === "priority" && (
          <EnumSelectField
            value={issue.priority ?? NO_SELECTION}
            onValueChange={(value) => {
              const next = value === NO_SELECTION ? null : (value as Priority);
              closeQuickEdit();
              if (next !== (issue.priority ?? null)) {
                commitPatch({ priority: next });
              }
            }}
            options={PRIORITY_OPTIONS}
            renderItem={renderPriorityOption}
            placeholder={empty.noPriority}
            noneOption={{ value: NO_SELECTION, label: empty.noPriority }}
            testId="issue-quick-edit-priority"
            open
            onOpenChange={closeOpenField}
            disabled={mutation.isPending}
            triggerClassName="bg-popover shadow-lg shadow-foreground/10"
          />
        )}

        {field === "assignee" && (
          <AssigneeCombobox
            value={issue.assigned_to ?? ""}
            onChange={(value) => {
              closeQuickEdit();
              if (value !== (issue.assigned_to ?? "")) {
                commitPatch({ assigned_to: value || null });
              }
            }}
            vault={vault}
            label={fieldNames.assignee}
            emptyLabel={empty.unassigned}
            align="start"
            panelClassName="min-w-64"
            open
            onOpenChange={closeOpenField}
            disabled={mutation.isPending}
          />
        )}

        {field === "labels" && (
          <Popover open onOpenChange={closeOpenField}>
            <PopoverTrigger className="h-8 w-full justify-start rounded-md border border-border bg-popover px-2.5 text-[13px] text-foreground shadow-lg shadow-foreground/10">
              {fieldNames.labels}
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2">
              <LabelChipInput
                value={issue.labels ?? []}
                onChange={(next) => {
                  if (!sameStringArray(next, issue.labels ?? [])) {
                    commitPatch({ labels: next });
                  }
                }}
                placeholder={common("addLabelPlaceholder")}
                data-testid="issue-quick-edit-labels"
                autoFocus
                disabled={mutation.isPending}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>
    );

  return (
    <>
      {anchor}
      <CloseIssueDialog
        open={pendingClose}
        issueId={issue.id}
        disabled={mutation.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingClose(false);
        }}
        onConfirm={confirmClose}
      />
    </>
  );
}
