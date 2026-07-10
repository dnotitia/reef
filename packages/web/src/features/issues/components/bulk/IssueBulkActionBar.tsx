"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { EnumSelectField } from "@/components/fields/EnumSelectField";
import { PlanningKindIcon } from "@/components/fields/PlanningKindIcon";
import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
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
import { usePlanningCatalog } from "@/features/planning/hooks/usePlanningCatalog";
import {
  isAssignablePlanningItem,
  itemsForKind,
} from "@/features/planning/lib/planningItems";
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
import {
  CheckSquare2,
  ChevronDown,
  ChevronLeft,
  MoreHorizontal,
  Tag,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface IssueBulkActionBarProps {
  vault: string;
}

type MoreMode = "menu" | "sprint" | "labels:add" | "labels:remove";

const renderStatus = (status: Status) => <StatusBadge status={status} />;
const renderPriority = (priority: Priority) => (
  <PriorityBadge priority={priority} />
);

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
  const { data: planningCatalog, isPending: planningPending } =
    usePlanningCatalog(vault);
  const sprints = useMemo(
    () =>
      itemsForKind(planningCatalog, "sprints").filter((item) =>
        isAssignablePlanningItem("sprints", item),
      ),
    [planningCatalog],
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreMode, setMoreMode] = useState<MoreMode>("menu");
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

  function closeMore() {
    setMoreOpen(false);
    setMoreMode("menu");
    setLabels([]);
  }

  const labelMode =
    moreMode === "labels:add"
      ? "add"
      : moreMode === "labels:remove"
        ? "remove"
        : null;

  return (
    <div
      className="border-b border-border-subtle bg-background px-6 py-2"
      data-testid="issue-bulk-action-bar"
    >
      <div
        className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/5 px-2.5 py-1.5 shadow-sm"
        aria-busy={runner.running}
      >
        <span
          className="inline-flex min-w-max items-center gap-2 px-1 text-sm font-semibold"
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

        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />

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

        <Popover
          open={moreOpen}
          onOpenChange={(open) => {
            setMoreOpen(open);
            if (!open) {
              setMoreMode("menu");
              setLabels([]);
            }
          }}
        >
          <PopoverTrigger
            disabled={runner.running}
            className="h-8 gap-1.5 rounded-md border border-border bg-elevated px-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:opacity-50"
            data-testid="bulk-more"
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            {bulk("more")}
            <ChevronDown
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
          </PopoverTrigger>
          <PopoverContent className="w-72 p-1.5" align="start">
            {moreMode === "menu" ? (
              <div className="grid gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setMoreMode("sprint")}
                >
                  <PlanningKindIcon kind="sprints" decorative size={14} />
                  {fieldNames.sprint}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setMoreMode("labels:add")}
                >
                  <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                  {bulk("addLabels")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setMoreMode("labels:remove")}
                >
                  <Tag className="h-3.5 w-3.5" aria-hidden="true" />
                  {bulk("removeLabels")}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-1 border-b border-border-subtle pb-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={bulk("back")}
                    onClick={() => {
                      setMoreMode("menu");
                      setLabels([]);
                    }}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <span className="text-xs font-semibold text-foreground">
                    {moreMode === "sprint"
                      ? fieldNames.sprint
                      : labelMode === "remove"
                        ? bulk("removeLabels")
                        : bulk("addLabels")}
                  </span>
                </div>

                {moreMode === "sprint" ? (
                  <div className="max-h-64 overflow-y-auto">
                    <button
                      type="button"
                      className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover"
                      onClick={() => {
                        closeMore();
                        void execute({ kind: "sprint", value: null });
                      }}
                    >
                      {bulk("noSprint")}
                    </button>
                    {planningPending ? (
                      <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                        {bulk("loadingSprints")}
                      </p>
                    ) : sprints.length === 0 ? (
                      <p className="px-2 py-1.5 text-[13px] text-muted-foreground">
                        {bulk("noSprints")}
                      </p>
                    ) : (
                      sprints.map((sprint) => (
                        <button
                          key={sprint.id}
                          type="button"
                          className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover"
                          data-testid={`bulk-sprint-option-${sprint.id}`}
                          onClick={() => {
                            closeMore();
                            void execute({ kind: "sprint", value: sprint.id });
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {sprint.name}
                          </span>
                          <PlanningStatusBadge
                            kind="sprints"
                            status={sprint.status}
                            className="shrink-0"
                          />
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <>
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
                        closeMore();
                        void execute({
                          kind: `labels:${labelMode}`,
                          value: labels,
                        });
                      }}
                    >
                      {labelMode === "remove"
                        ? bulk("removeLabels")
                        : bulk("addLabels")}
                    </Button>
                  </>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>

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

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
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
