"use client";

import { DatePickerField } from "@/components/fields/DatePickerField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  isValidUtcCalendarDate,
  summarizeSprintRolloverIssues,
  suggestSprintRolloverDates,
  suggestSprintRolloverName,
  toUtcCalendarDate,
  type IssueListItem,
  type PlanningCatalog,
  type Sprint,
  type SprintRolloverResult,
  type SprintRolloverTarget,
} from "@reef/core";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { sprintDetailHref } from "../lib/planningUrls";
import {
  useCloseSprintAndRollover,
  type PlanningItem,
} from "../hooks/usePlanningCatalog";

type IssueAggregationState = "loading" | "error" | "available";
type TargetMode = "existing" | "new";

const TARGET_MODE_KEYS = {
  existing: "existingTarget",
  new: "newTarget",
} as const;

const REASON_KEYS: Record<string, string> = {
  archived: "reasons.archived",
  moved_to_other_sprint: "reasons.moved_to_other_sprint",
  issue_not_found: "reasons.issue_not_found",
  issue_read_failed: "reasons.issue_read_failed",
  issue_update_failed: "reasons.issue_update_failed",
  activity_pending: "reasons.activity_pending",
  row_conflict: "reasons.row_conflict",
  status_done: "reasons.status_done",
  status_closed: "reasons.status_closed",
  status_backlog: "reasons.status_backlog",
  other_active_sprint: "reasons.other_active_sprint",
};

function rolloverTranslator(
  translate: ReturnType<typeof useTranslations>,
): (key: string, values?: Record<string, string | number>) => string {
  return translate as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
}

function initialTargetItem(
  source: Sprint,
  now: number | null,
): {
  name: string;
  startDate: string;
  endDate: string;
  sourceEndDate: string;
} {
  const dates = suggestSprintRolloverDates(source, now ?? Date.now());
  return {
    name: suggestSprintRolloverName(source.name),
    startDate: dates.targetStartDate,
    endDate: dates.targetEndDate ?? "",
    sourceEndDate: dates.sourceEndDate,
  };
}

function reasonText(
  translate: (key: string, values?: Record<string, string | number>) => string,
  reason: string | undefined,
): string | undefined {
  if (!reason) return undefined;
  const key = REASON_KEYS[reason];
  return key ? translate(key) : reason;
}

function PhaseSummary({
  result,
  translate,
}: {
  result: SprintRolloverResult;
  translate: (key: string, values?: Record<string, string | number>) => string;
}) {
  const phases = [
    ["target_preparation", "phaseTargetPreparation"],
    ["source_close", "phaseSourceClose"],
    ["target_activation", "phaseTargetActivation"],
    ["issue_rollover", "phaseIssueRollover"],
  ] as const;
  return (
    <ul
      data-testid="sprint-rollover-phases"
      className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2"
    >
      {phases.map(([phase, labelKey]) => {
        const status = result.phases[phase];
        return (
          <li key={phase} className="flex items-center justify-between gap-3">
            <span>{translate(labelKey)}</span>
            <span
              className={
                status === "completed"
                  ? "text-status-done-text"
                  : status === "not_started"
                    ? "text-muted-foreground"
                    : "text-destructive-text"
              }
            >
              {status === "completed"
                ? "✓"
                : status === "not_started"
                  ? "—"
                  : translate("phaseFailed")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SprintRolloverDialog({
  open,
  onOpenChange,
  vault,
  source,
  catalog,
  issues,
  issueState,
  now,
  canEdit,
  onRetryIssues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vault: string;
  source: Sprint | null;
  catalog: PlanningCatalog | undefined;
  issues: readonly IssueListItem[] | undefined;
  issueState: IssueAggregationState;
  now: number | null;
  canEdit: boolean;
  onRetryIssues?: () => void;
}) {
  const translate = rolloverTranslator(useTranslations("planning.rollover"));
  const common = useTranslations("common");
  const [targetMode, setTargetMode] = useState<TargetMode>("new");
  const [targetId, setTargetId] = useState("");
  const [targetName, setTargetName] = useState("");
  const [sourceEndDate, setSourceEndDate] = useState("");
  const [targetStartDate, setTargetStartDate] = useState("");
  const [targetEndDate, setTargetEndDate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<SprintRolloverResult | null>(null);
  const initializedFor = useRef<string | null>(null);
  const targetDatesAreSuggested = useRef(true);
  const targetNameInputId = useId();
  const mutation = useCloseSprintAndRollover(vault);

  const plannedTargets = (catalog?.sprints ?? []).filter(
    (item) =>
      item.id !== source?.id &&
      (item.status === "planned" || item.id === targetId),
  );
  const preview =
    issueState === "available" && issues && source
      ? summarizeSprintRolloverIssues(issues, source.id)
      : null;

  useEffect(() => {
    if (!open) {
      initializedFor.current = null;
      return;
    }
    if (!source || initializedFor.current === source.id) return;
    const initial = initialTargetItem(source, now);
    initializedFor.current = source.id;
    targetDatesAreSuggested.current = true;
    setTargetMode("new");
    setTargetId("");
    setTargetName(initial.name);
    setSourceEndDate(initial.sourceEndDate);
    setTargetStartDate(initial.startDate);
    setTargetEndDate(initial.endDate);
    setFormError(null);
    setResult(null);
  }, [now, open, source]);

  async function submit() {
    if (!source) return;
    setFormError(null);
    if (!canEdit) {
      setFormError(translate("readerDisabled"));
      return;
    }
    if (issueState !== "available" || !issues) {
      setFormError(translate("issuesUnavailable"));
      return;
    }
    const normalizedEnd = toUtcCalendarDate(sourceEndDate);
    if (!normalizedEnd || !isValidUtcCalendarDate(normalizedEnd)) {
      setFormError(translate("sourceEndRequired"));
      return;
    }
    const sourceStart = toUtcCalendarDate(source.start_date);
    if (sourceStart && sourceStart > normalizedEnd) {
      setFormError(translate("sourceEndRequired"));
      return;
    }

    let target: SprintRolloverTarget;
    if (targetMode === "existing") {
      if (!targetId) {
        setFormError(translate("targetRequired"));
        return;
      }
      const selectedTarget = plannedTargets.find(
        (item) => item.id === targetId,
      );
      const selectedStart = toUtcCalendarDate(selectedTarget?.start_date);
      const selectedEnd = toUtcCalendarDate(selectedTarget?.end_date);
      if (!selectedStart || !selectedEnd || selectedStart > selectedEnd) {
        setFormError(translate("existingTargetDatesInvalid"));
        return;
      }
      target = { kind: "existing", id: targetId };
    } else {
      if (!targetName.trim()) {
        setFormError(translate("targetNameRequired"));
        return;
      }
      if (
        (catalog?.sprints ?? []).some(
          (item) =>
            item.name.trim().toLowerCase() === targetName.trim().toLowerCase(),
        )
      ) {
        setFormError(translate("duplicateName"));
        return;
      }
      const normalizedTargetStart = toUtcCalendarDate(targetStartDate);
      const normalizedTargetEnd = toUtcCalendarDate(targetEndDate);
      if (!normalizedTargetStart || !normalizedTargetEnd) {
        setFormError(translate("targetDatesRequired"));
        return;
      }
      if (normalizedTargetStart > normalizedTargetEnd) {
        setFormError(translate("targetDatesInvalid"));
        return;
      }
      target = {
        kind: "new",
        item: {
          name: targetName.trim(),
          status: "planned",
          start_date: normalizedTargetStart,
          end_date: normalizedTargetEnd,
          goal: "",
          capacity_points: null,
        },
      };
    }

    try {
      const next = await mutation.mutateAsync({
        sourceSprintId: source.id,
        endDate: normalizedEnd,
        target,
      });
      setResult(next);
      if (next.target_sprint_id) {
        setTargetMode("existing");
        setTargetId(next.target_sprint_id);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : common("retry"));
    }
  }

  if (!source) return null;

  const isBusy = mutation.isPending;
  const showResult = result !== null;
  const completed = result?.status === "completed";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isBusy) onOpenChange(next);
      }}
    >
      <DialogContent
        data-testid="sprint-rollover-dialog"
        className="grid max-h-[calc(100dvh-2rem)] min-h-0 max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-5 overflow-hidden pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
        onInteractOutside={(event) => {
          if (isBusy) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isBusy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {translate("dialogTitle", { name: source.name })}
          </DialogTitle>
          <DialogDescription>
            {translate("dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain">
          <div className="grid gap-4">
            <section
              aria-labelledby="sprint-rollover-preview"
              className="rounded-md border border-border-subtle bg-surface-subtle/40 p-3"
            >
              <h2
                id="sprint-rollover-preview"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {translate("preview")}
              </h2>
              {issueState === "loading" ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {translate("issuesLoading")}
                </p>
              ) : issueState === "error" || !preview ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p role="alert" className="text-sm text-destructive-text">
                    {translate("issuesUnavailable")}
                  </p>
                  {onRetryIssues ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={onRetryIssues}
                    >
                      {common("retry")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <PreviewCount
                    label={translate("eligible")}
                    value={preview.eligible}
                    strong
                  />
                  <PreviewCount
                    label={translate("doneRemain")}
                    value={preview.done}
                  />
                  <PreviewCount
                    label={translate("closedRemain")}
                    value={preview.closed}
                  />
                  <PreviewCount
                    label={translate("backlogExcluded")}
                    value={preview.backlog}
                  />
                  <PreviewCount
                    label={translate("archivedExcluded")}
                    value={preview.archived}
                  />
                </dl>
              )}
            </section>

            <div className="grid gap-3">
              <DatePickerField
                label={translate("sourceEnd")}
                value={sourceEndDate}
                onChange={(value) => {
                  setSourceEndDate(value);
                  if (targetDatesAreSuggested.current) {
                    const dates = suggestSprintRolloverDates(
                      { start_date: source.start_date, end_date: value },
                      now ?? Date.now(),
                    );
                    setTargetStartDate(dates.targetStartDate);
                    setTargetEndDate(dates.targetEndDate ?? "");
                  }
                }}
                disabled={isBusy}
                clearable={false}
              />
              <fieldset className="grid gap-2">
                <legend className="text-xs font-medium text-muted-foreground">
                  {translate("targetChoice")}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["existing", "new"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={targetMode === mode}
                      onClick={() => {
                        setTargetMode(mode);
                        setFormError(null);
                      }}
                      disabled={isBusy}
                      className="rounded-md border border-border-subtle px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover aria-pressed:border-brand-focus aria-pressed:bg-brand-fill/[0.06]"
                    >
                      {translate(TARGET_MODE_KEYS[mode])}
                    </button>
                  ))}
                </div>
              </fieldset>

              {targetMode === "existing" ? (
                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                  {translate("targetChoice")}
                  <select
                    data-testid="sprint-rollover-existing-target"
                    value={targetId}
                    onChange={(event) => setTargetId(event.target.value)}
                    disabled={isBusy}
                    className="h-8 rounded-md border border-border bg-surface-elevated px-2 text-sm text-foreground focus:border-brand-focus focus:outline-none focus:ring-2 focus:ring-brand-focus"
                  >
                    <option value="">{translate("chooseTarget")}</option>
                    {plannedTargets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  {targetId ? (
                    <span className="text-muted-foreground">
                      {translate("targetDates")}:{" "}
                      {formatTargetDates(plannedTargets, targetId)}
                    </span>
                  ) : null}
                </label>
              ) : (
                <div className="grid gap-3 rounded-md border border-border-subtle p-3">
                  <label
                    htmlFor={targetNameInputId}
                    className="grid gap-1 text-xs font-medium text-muted-foreground"
                  >
                    {translate("targetName")}
                    <Input
                      data-testid="sprint-rollover-target-name"
                      id={targetNameInputId}
                      value={targetName}
                      onChange={(event) => setTargetName(event.target.value)}
                      disabled={isBusy}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DatePickerField
                      label={translate("targetStart")}
                      value={targetStartDate}
                      onChange={(value) => {
                        targetDatesAreSuggested.current = false;
                        setTargetStartDate(value);
                      }}
                      disabled={isBusy}
                      clearable={false}
                    />
                    <DatePickerField
                      label={translate("targetEnd")}
                      value={targetEndDate}
                      onChange={(value) => {
                        targetDatesAreSuggested.current = false;
                        setTargetEndDate(value);
                      }}
                      disabled={isBusy}
                      clearable={false}
                      align="end"
                    />
                  </div>
                </div>
              )}
            </div>

            {showResult ? (
              <section
                data-testid="sprint-rollover-result"
                role={completed ? "status" : "alert"}
                className={
                  completed
                    ? "grid gap-3 rounded-md border border-status-done-focus/40 bg-status-done-fill/5 p-3"
                    : "grid gap-3 rounded-md border border-status-in-progress-focus/40 bg-status-in-progress-fill/5 p-3"
                }
              >
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {completed
                      ? result.no_op
                        ? translate("noOp")
                        : translate("completed")
                      : translate("partialTitle")}
                  </h2>
                  {!completed ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {translate("partialDescription")}
                    </p>
                  ) : null}
                </div>
                <PhaseSummary result={result} translate={translate} />
                {result.phase_errors.length > 0 ? (
                  <ul
                    data-testid="sprint-rollover-phase-errors"
                    className="grid gap-1 text-xs text-destructive-text"
                  >
                    {result.phase_errors.map((error) => (
                      <li key={`${error.phase}:${error.reason}`}>
                        {phaseLabel(translate, error.phase)}:{" "}
                        {translate("phaseFailed")}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {translate("moved", { count: result.counts.moved })}
                  </span>
                  <span>
                    {translate("skipped", { count: result.counts.skipped })}
                  </span>
                  <span>
                    {translate("failed", { count: result.counts.failed })}
                  </span>
                  <span>
                    {translate("conflicts", { count: result.counts.conflicts })}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {translate("doneRemain")}: {result.counts.done}
                  </span>
                  <span>
                    {translate("closedRemain")}: {result.counts.closed}
                  </span>
                  <span>
                    {translate("backlogExcluded")}: {result.counts.backlog}
                  </span>
                  <span>
                    {translate("archivedExcluded")}: {result.counts.archived}
                  </span>
                </div>
                {result.target_sprint ? (
                  <a
                    data-testid="sprint-rollover-target-link"
                    href={sprintDetailHref(vault, result.target_sprint.id)}
                    className="type-control font-medium text-brand-text underline-offset-2 hover:underline"
                  >
                    {result.target_sprint.name}
                  </a>
                ) : null}
                {result.issue_results.some((item) => item.reason) ? (
                  <ul className="grid gap-1 text-xs text-muted-foreground">
                    {result.issue_results
                      .filter((item) => item.reason)
                      .map((item) => (
                        <li
                          key={item.id}
                          data-testid={`sprint-rollover-issue-${item.id}`}
                        >
                          {item.id}: {reasonText(translate, item.reason)}
                        </li>
                      ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {formError ? (
              <p
                data-testid="sprint-rollover-error"
                role="alert"
                className="rounded-md border border-destructive-focus/30 bg-destructive-fill/5 px-3 py-2 text-sm text-destructive-text"
              >
                {formError}
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
            data-testid={completed ? "sprint-rollover-close" : undefined}
          >
            {completed ? common("close") : common("cancel")}
          </Button>
          {completed ? null : (
            <Button
              type="button"
              data-testid="sprint-rollover-submit"
              onClick={() => void submit()}
              disabled={isBusy || issueState !== "available" || !canEdit}
              busy={isBusy}
            >
              {isBusy
                ? common("loading")
                : result?.retryable
                  ? translate("retry")
                  : translate("confirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewCount({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          strong
            ? "font-semibold text-foreground"
            : "tabular-nums text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function phaseLabel(
  translate: (key: string, values?: Record<string, string | number>) => string,
  phase: string,
): string {
  const keys: Record<string, string> = {
    target_preparation: "phaseTargetPreparation",
    source_close: "phaseSourceClose",
    target_activation: "phaseTargetActivation",
    issue_rollover: "phaseIssueRollover",
  };
  return translate(keys[phase] ?? phase);
}

function formatTargetDates(
  targets: readonly PlanningItem[],
  id: string,
): string {
  const target = targets.find((item) => item.id === id) as Sprint | undefined;
  if (!target) return "—";
  return `${target.start_date?.slice(0, 10) ?? "?"} – ${target.end_date?.slice(0, 10) ?? "?"}`;
}
