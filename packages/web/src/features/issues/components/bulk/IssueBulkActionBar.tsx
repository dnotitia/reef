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
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface IssueBulkActionBarProps {
  vault: string;
}

const renderStatus = (status: Status) => <StatusBadge status={status} />;
const renderPriority = (priority: Priority) => (
  <PriorityBadge priority={priority} />
);

export function IssueBulkActionBar({ vault }: IssueBulkActionBarProps) {
  const selectedIds = useIssueSelectionStore((state) => state.selectedIds);
  const clear = useIssueSelectionStore((state) => state.clear);
  const ids = [...selectedIds];
  const bulk = useTranslations("issues.bulk");
  const fieldNames = useFieldNameLabels();
  const empty = useEnrichmentEmptyLabels();
  const runner = useBulkUpdateIssues(vault);
  const [labelMode, setLabelMode] = useState<"add" | "remove" | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
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
      className="fixed bottom-5 left-1/2 z-30 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-popover/95 p-2 shadow-xl backdrop-blur"
      data-testid="issue-bulk-action-bar"
    >
      <span className="min-w-max px-2 text-sm font-semibold" aria-live="polite">
        {runner.running
          ? bulk("progress", {
              processed: runner.processed,
              total: runner.total,
            })
          : bulk("selectedCount", { count: ids.length })}
      </span>

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
        triggerClassName="w-36"
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
        triggerClassName="w-36"
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
        className="w-40"
        testId="bulk-sprint"
      />

      <Popover
        open={labelMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLabelMode(null);
            setLabels([]);
          }
        }}
      >
        <div className="flex items-center gap-1">
          <PopoverTrigger
            disabled={runner.running}
            className="h-7 rounded-md border border-border bg-elevated px-2.5 text-xs font-medium text-foreground hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50"
            onClick={() => setLabelMode("add")}
          >
            {bulk("addLabels")}
          </PopoverTrigger>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={runner.running}
            onClick={() => setLabelMode("remove")}
          >
            {bulk("removeLabels")}
          </Button>
        </div>
        <PopoverContent className="w-72 space-y-2" align="center">
          <LabelChipInput
            value={labels}
            onChange={setLabels}
            autoFocus
            data-testid="bulk-label-input"
          />
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={labels.length === 0 || runner.running}
            onClick={() => {
              if (!labelMode) return;
              void execute({ kind: `labels:${labelMode}`, value: labels });
              setLabelMode(null);
              setLabels([]);
            }}
          >
            {labelMode === "remove" ? bulk("removeLabels") : bulk("addLabels")}
          </Button>
        </PopoverContent>
      </Popover>

      {runner.failures.length > 0 && (
        <Popover>
          <PopoverTrigger className="h-7 rounded-md bg-destructive px-2.5 text-xs font-medium text-destructive-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
            {bulk("failedCount", { count: runner.failures.length })}
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-2" align="center">
            {runner.failures.map((failure) => (
              <div key={failure.id} className="flex items-center gap-2 text-sm">
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

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={runner.running}
        onClick={clear}
      >
        {bulk("clear")}
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
  );
}
