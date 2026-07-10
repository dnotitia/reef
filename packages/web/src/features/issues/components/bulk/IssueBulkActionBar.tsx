"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { Button } from "@/components/ui/button";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PriorityBadge } from "@/components/ui/priority-dot";
import { StatusBadge } from "@/components/ui/status-icon";
import { CloseIssueDialog } from "@/features/issues/components/detail/CloseIssueDialog";
import {
  type BulkIssueFailure,
  useBulkUpdateIssues,
} from "@/features/issues/hooks/mutations/useBulkUpdateIssues";
import type { BulkIssueOperation } from "@/features/issues/lib/bulkIssueUpdate";
import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { PlanningItemCombobox } from "@/features/planning/components/PlanningItemCombobox";
import {
  useEnrichmentEmptyLabels,
  useFieldNameLabels,
} from "@/i18n/fieldLabels";
import type { ClosedReason, Priority, Status } from "@reef/core";
import {
  NO_SELECTION,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
} from "@reef/core/fields";
import { CheckSquare2, ChevronDown, Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface IssueBulkActionBarProps {
  vault: string;
}

interface LabelBulkActionProps {
  disabled: boolean;
  label: string;
  onApply: (labels: string[]) => void;
  testId: string;
}

const renderStatus = (status: Status) => <StatusBadge status={status} />;
const renderPriority = (priority: Priority) => (
  <PriorityBadge priority={priority} />
);

function LabelBulkAction({
  disabled,
  label,
  onApply,
  testId,
}: LabelBulkActionProps) {
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  function setPopoverOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      setLabels([]);
      setDraft("");
    }
  }

  function applyLabels() {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const raw of [...labels, draft]) {
      const trimmed = raw.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      next.push(trimmed);
    }
    if (next.length === 0) return;
    onApply(next);
    setPopoverOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setPopoverOpen} className="shrink-0">
      <PopoverTrigger
        disabled={disabled}
        className="h-8 gap-1.5 rounded-md border border-border bg-elevated px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50"
        data-testid={testId}
      >
        <Tag className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
        <ChevronDown
          className="h-3.5 w-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-2 p-2" align="start">
        <LabelChipInput
          value={labels}
          onChange={setLabels}
          onDraftChange={setDraft}
          autoFocus
          data-testid={`${testId}-input`}
        />
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={(labels.length === 0 && !draft.trim()) || disabled}
          onClick={applyLabels}
        >
          {label}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * List-only selection toolbar. It lives in the document flow directly above
 * the table, so bulk editing reads as a focused list mode instead of a floating
 * form competing with Ask AI or covering issue content.
 */
export function IssueBulkActionBar({ vault }: IssueBulkActionBarProps) {
  const selectedIds = useIssueSelectionStore((state) => state.selectedIds);
  const clear = useIssueSelectionStore((state) => state.clear);
  const ids = [...selectedIds];
  const bulk = useTranslations("issues.bulk");
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const runner = useBulkUpdateIssues(vault);
  const [pendingClose, setPendingClose] = useState(false);

  useEffect(() => {
    if (ids.length === 0) runner.reset();
  }, [ids.length, runner.reset]);

  if (ids.length === 0) return null;

  async function execute(operation: BulkIssueOperation) {
    const result = await runner.run(ids, operation);
    if (result.failures.length > 0) {
      toast.error(
        bulk("partialFailure", {
          failed: result.failures.length,
          total: result.total,
        }),
      );
    } else {
      toast.success(
        bulk("success", {
          count: result.succeeded.length + result.unchanged.length,
        }),
      );
    }
  }

  async function retryFailure(failure: BulkIssueFailure) {
    const result = await runner.retry(failure);
    if (result.failures.length > 0)
      toast.error(
        bulk(`errors.${result.failures[0]?.reason ?? "request_failed"}`),
      );
    else toast.success(bulk("retrySuccess", { id: failure.id }));
  }

  return (
    <div
      className="border-b border-border-subtle bg-background px-6 py-2"
      data-testid="issue-bulk-action-bar"
    >
      <div
        className="flex min-h-10 items-start gap-2 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 shadow-sm"
        aria-busy={runner.running}
      >
        <span
          className="inline-flex min-h-8 min-w-max items-center gap-2 px-1 text-sm font-semibold"
          aria-live="polite"
        >
          <CheckSquare2 className="h-4 w-4 text-brand" aria-hidden="true" />
          {runner.running
            ? bulk("progress", {
                processed: runner.processed,
                total: runner.total,
              })
            : bulk("selectedCount", { count: ids.length })}
        </span>

        <span className="mx-0.5 mt-1.5 h-5 w-px bg-border" aria-hidden="true" />

        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
          data-testid="bulk-actions"
        >
          <EnumSelectField
            value=""
            onValueChange={(value) => {
              if (value === "closed") setPendingClose(true);
              else void execute({ kind: "status", value: value as Status });
            }}
            options={STATUS_OPTIONS}
            renderItem={renderStatus}
            placeholder={fieldNames.status}
            disabled={runner.running}
            triggerClassName="w-32"
            testId="bulk-status"
          />
          <AssigneeCombobox
            value=""
            onChange={(value) =>
              void execute({ kind: "assignee", value: value || null })
            }
            vault={vault}
            label={fieldNames.assignee}
            placeholder={fieldNames.assignee}
            emptyLabel={empty.unassigned}
            align="start"
            disabled={runner.running}
            className="w-36 shrink-0"
            panelClassName="min-w-64"
          />
          <EnumSelectField
            value=""
            onValueChange={(value) =>
              void execute({
                kind: "priority",
                value: value === NO_SELECTION ? null : (value as Priority),
              })
            }
            options={PRIORITY_OPTIONS}
            renderItem={renderPriority}
            placeholder={fieldNames.priority}
            noneOption={{ value: NO_SELECTION, label: empty.noPriority }}
            disabled={runner.running}
            triggerClassName="w-32"
            testId="bulk-priority"
          />
          <PlanningItemCombobox
            kind="sprints"
            vault={vault}
            value=""
            onChange={(value) =>
              void execute({ kind: "sprint", value: value || null })
            }
            label={fieldNames.sprint}
            placeholder={fieldNames.sprint}
            emptyLabel={bulk("noSprint")}
            disabled={runner.running}
            assignableOnly
            className="w-36 shrink-0"
            panelClassName="min-w-72"
            testId="bulk-sprint"
          />
          <LabelBulkAction
            label={bulk("addLabels")}
            disabled={runner.running}
            testId="bulk-add-labels"
            onApply={(labels) =>
              void execute({ kind: "labels:add", value: labels })
            }
          />
          <LabelBulkAction
            label={bulk("removeLabels")}
            disabled={runner.running}
            testId="bulk-remove-labels"
            onApply={(labels) =>
              void execute({ kind: "labels:remove", value: labels })
            }
          />

          {runner.failures.length > 0 && (
            <Popover>
              <PopoverTrigger className="h-7 rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                {bulk("failedCount", { count: runner.failures.length })}
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-2" align="start">
                {runner.failures.map((failure) => (
                  <div
                    key={failure.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <strong>{failure.id}</strong> · {failure.title} ·{" "}
                      {bulk(`errors.${failure.reason}`)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={runner.running}
                      onClick={() => void retryFailure(failure)}
                    >
                      {bulk("retry")}
                    </Button>
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          disabled={runner.running}
          aria-label={bulk("clear")}
          title={bulk("clear")}
          onClick={clear}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>

        <CloseIssueDialog
          open={pendingClose}
          issueId={bulk("selectedCount", { count: ids.length })}
          disabled={runner.running}
          onOpenChange={setPendingClose}
          onConfirm={(reason: ClosedReason) => {
            setPendingClose(false);
            void execute({
              kind: "status",
              value: "closed",
              closedReason: reason,
            });
          }}
        />
      </div>
    </div>
  );
}
