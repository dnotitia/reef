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
  type SprintRolloverResume,
  type SprintRolloverTarget,
} from "@reef/core";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { sprintDetailHref } from "../lib/planningUrls";
import {
  useCloseSprintAndRollover,
  type PlanningItem,
} from "../hooks/usePlanningCatalog";

type IssueAggregationState = "loading" | "error" | "available";
type TargetMode = "existing" | "new";
type RolloverField =
  | "sourceEnd"
  | "targetName"
  | "existingTarget"
  | "targetStart"
  | "targetEnd";
type FieldErrors = Partial<Record<RolloverField, string>>;

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

function FieldError({ id, children }: { id: string; children: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="text-xs text-destructive-text"
      data-testid={id}
    >
      {children}
    </p>
  );
}

function CompletedRolloverSummary({
  result,
  vault,
  translate,
}: {
  result: SprintRolloverResult;
  vault: string;
  translate: (key: string, values?: Record<string, string | number>) => string;
}) {
  const target = result.target_sprint;
  const closeDate = result.source_sprint.end_date?.slice(0, 10) ?? "—";

  return (
    <section
      data-testid="sprint-rollover-complete"
      role="status"
      className="grid gap-5 rounded-lg border border-status-done-focus/40 bg-status-done-fill/5 p-4 sm:p-5"
    >
      <div className="flex items-center gap-3">
        <CheckCircle2
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-status-done-text"
        />
        <p
          data-testid="sprint-rollover-completed-count"
          className="text-lg font-semibold text-status-done-text"
        >
          {translate("completedMoved", { count: result.counts.moved })}
        </p>
      </div>

      <div className="grid gap-3 border-y border-status-done-focus/20 py-3">
        <div
          data-testid="sprint-rollover-completed-route"
          className="grid min-w-0 gap-1.5 text-sm font-medium text-foreground sm:flex sm:items-center sm:gap-2"
        >
          <span className="min-w-0 break-words">
            {result.source_sprint.name}
          </span>
          <ArrowRight
            aria-hidden="true"
            className="size-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0"
          />
          <span className="min-w-0 break-words">{target?.name ?? "—"}</span>
        </div>
        <dl className="grid gap-1 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <dt>{translate("confirmedCloseDate")}</dt>
            <dd className="font-mono tabular-nums text-foreground">
              <time dateTime={closeDate === "—" ? undefined : closeDate}>
                {closeDate}
              </time>
            </dd>
          </div>
        </dl>
      </div>

      {target ? (
        <a
          data-testid="sprint-rollover-target-link"
          href={sprintDetailHref(vault, target.id)}
          aria-label={translate("openCompletedTarget", { name: target.name })}
          className="type-control inline-flex min-h-8 w-fit max-w-full items-center rounded-md font-medium text-brand-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus [@media(pointer:coarse)]:min-h-11"
        >
          <span className="truncate">{target.name}</span>
        </a>
      ) : null}
    </section>
  );
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
  resume,
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
  resume?: SprintRolloverResume | null;
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<SprintRolloverResult | null>(null);
  const initializedFor = useRef<string | null>(null);
  const sourceAtOpen = useRef<Sprint | null>(null);
  const targetDatesAreSuggested = useRef(true);
  const targetNameInputId = useId();
  const sourceEndInputId = useId();
  const existingTargetInputId = useId();
  const targetStartInputId = useId();
  const targetEndInputId = useId();
  const mutation = useCloseSprintAndRollover(vault);

  const sourceEndErrorId = `${sourceEndInputId}-error`;
  const existingTargetErrorId = `${existingTargetInputId}-error`;
  const targetNameErrorId = `${targetNameInputId}-error`;
  const targetStartErrorId = `${targetStartInputId}-error`;
  const targetEndErrorId = `${targetEndInputId}-error`;

  const resumeSource = resume?.result.source_sprint;
  const dialogSource = sourceAtOpen.current ?? source ?? resumeSource;

  useEffect(() => {
    if (!open) {
      sourceAtOpen.current = null;
      return;
    }
    if (!sourceAtOpen.current && (source ?? resumeSource)) {
      sourceAtOpen.current = source ?? resumeSource ?? null;
    }
  }, [open, resumeSource, source]);

  function clearFieldError(field: RolloverField) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError(null);
  }

  function clearValidationErrors() {
    setFieldErrors({});
    setFormError(null);
  }

  function setFieldValidationError(field: RolloverField, message: string) {
    setFieldErrors({ [field]: message });
    setFormError(null);
  }

  const plannedTargets = (catalog?.sprints ?? []).filter(
    (item) =>
      item.id !== dialogSource?.id &&
      (item.status === "planned" || item.id === targetId),
  );
  const preview =
    issueState === "available" && issues && dialogSource
      ? summarizeSprintRolloverIssues(issues, dialogSource.id)
      : null;

  useEffect(() => {
    if (!open) {
      initializedFor.current = null;
      return;
    }
    if (!dialogSource || initializedFor.current === dialogSource.id) return;
    const matchingResume =
      resume?.result.source_sprint_id === dialogSource.id ? resume : null;
    const initial = initialTargetItem(dialogSource, now);
    initializedFor.current = dialogSource.id;
    if (matchingResume) {
      const target = matchingResume.target;
      setTargetMode(target.kind);
      setTargetId(target.kind === "existing" ? target.id : "");
      setTargetName(
        target.kind === "new"
          ? target.item.name
          : (matchingResume.result.target_sprint?.name ?? ""),
      );
      setSourceEndDate(matchingResume.end_date);
      setTargetStartDate(
        target.kind === "new" ? (target.item.start_date ?? "") : "",
      );
      setTargetEndDate(
        target.kind === "new" ? (target.item.end_date ?? "") : "",
      );
      targetDatesAreSuggested.current = false;
      setFormError(null);
      setFieldErrors({});
      setResult(matchingResume.result);
      return;
    }
    targetDatesAreSuggested.current = true;
    setTargetMode("new");
    setTargetId("");
    setTargetName(initial.name);
    setSourceEndDate(initial.sourceEndDate);
    setTargetStartDate(initial.startDate);
    setTargetEndDate(initial.endDate);
    setFormError(null);
    setResult(null);
  }, [dialogSource, now, open, resume]);

  async function submit() {
    if (!dialogSource) return;
    clearValidationErrors();
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
      setFieldValidationError("sourceEnd", translate("sourceEndRequired"));
      return;
    }
    const sourceStart = toUtcCalendarDate(dialogSource.start_date);
    if (sourceStart && sourceStart > normalizedEnd) {
      setFieldValidationError("sourceEnd", translate("sourceEndRequired"));
      return;
    }

    let target: SprintRolloverTarget;
    if (targetMode === "existing") {
      if (!targetId) {
        setFieldValidationError("existingTarget", translate("targetRequired"));
        return;
      }
      const selectedTarget = plannedTargets.find(
        (item) => item.id === targetId,
      );
      const selectedStart = toUtcCalendarDate(selectedTarget?.start_date);
      const selectedEnd = toUtcCalendarDate(selectedTarget?.end_date);
      if (!selectedStart || !selectedEnd || selectedStart > selectedEnd) {
        setFieldValidationError(
          "existingTarget",
          translate("existingTargetDatesInvalid"),
        );
        return;
      }
      target = { kind: "existing", id: targetId };
    } else {
      if (!targetName.trim()) {
        setFieldValidationError("targetName", translate("targetNameRequired"));
        return;
      }
      if (
        !result?.retryable &&
        (catalog?.sprints ?? []).some(
          (item) =>
            item.name.trim().toLowerCase() === targetName.trim().toLowerCase(),
        )
      ) {
        setFieldValidationError("targetName", translate("duplicateName"));
        return;
      }
      const normalizedTargetStart = toUtcCalendarDate(targetStartDate);
      const normalizedTargetEnd = toUtcCalendarDate(targetEndDate);
      if (!normalizedTargetStart || !normalizedTargetEnd) {
        const nextErrors: FieldErrors = {};
        if (!normalizedTargetStart) {
          nextErrors.targetStart = translate("targetDatesRequired");
        }
        if (!normalizedTargetEnd) {
          nextErrors.targetEnd = translate("targetDatesRequired");
        }
        setFieldErrors(nextErrors);
        setFormError(null);
        return;
      }
      if (normalizedTargetStart > normalizedTargetEnd) {
        setFieldValidationError("targetEnd", translate("targetDatesInvalid"));
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
        sourceSprintId: dialogSource.id,
        endDate: normalizedEnd,
        target,
      });
      setResult(next);
      setFieldErrors({});
    } catch (error) {
      setFieldErrors({});
      setFormError(error instanceof Error ? error.message : common("retry"));
    }
  }

  if (!dialogSource) return null;

  const isBusy = mutation.isPending;
  const showResult = result !== null;
  const completed = result?.status === "completed";
  const retryLocked = result?.retryable === true;

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
        <DialogHeader className="pr-8 sm:pr-0">
          <DialogTitle className="min-w-0 break-words">
            {completed
              ? translate(result?.no_op ? "noOp" : "completedTitle")
              : translate("dialogTitle", { name: dialogSource.name })}
          </DialogTitle>
          <DialogDescription>
            {completed
              ? translate("completedDescription")
              : translate("dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {completed && result ? (
            <CompletedRolloverSummary
              result={result}
              vault={vault}
              translate={translate}
            />
          ) : (
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
                  <div className="mt-3 grid gap-3">
                    <dl className="grid gap-2">
                      <PreviewCount
                        label={translate("eligible")}
                        value={preview.eligible}
                        strong
                        featured
                      />
                      <div className="grid grid-cols-2 divide-x divide-border-subtle border-t border-border-subtle pt-2">
                        <PreviewCount
                          label={translate("doneShort")}
                          value={preview.done}
                          stacked
                        />
                        <PreviewCount
                          label={translate("closedShort")}
                          value={preview.closed}
                          stacked
                        />
                      </div>
                    </dl>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border-subtle pt-2 text-xs text-muted-foreground">
                      <PreviewCount
                        label={translate("backlogExcluded")}
                        value={preview.backlog}
                      />
                      <PreviewCount
                        label={translate("archivedExcluded")}
                        value={preview.archived}
                      />
                    </dl>
                  </div>
                )}
              </section>

              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <label
                    htmlFor={sourceEndInputId}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {translate("sourceEndLabel")}
                  </label>
                  <DatePickerField
                    id={sourceEndInputId}
                    label={translate("sourceEnd")}
                    value={sourceEndDate}
                    onChange={(value) => {
                      setSourceEndDate(value);
                      clearValidationErrors();
                      if (targetDatesAreSuggested.current) {
                        const dates = suggestSprintRolloverDates(
                          {
                            start_date: dialogSource.start_date,
                            end_date: value,
                          },
                          now ?? Date.now(),
                        );
                        setTargetStartDate(dates.targetStartDate);
                        setTargetEndDate(dates.targetEndDate ?? "");
                      }
                    }}
                    ariaDescribedBy={
                      fieldErrors.sourceEnd ? sourceEndErrorId : undefined
                    }
                    ariaInvalid={Boolean(fieldErrors.sourceEnd)}
                    ariaRequired
                    triggerClassName="[@media(pointer:coarse)]:min-h-11 disabled:cursor-not-allowed"
                    disabled={isBusy || retryLocked}
                    clearable={false}
                  />
                  {fieldErrors.sourceEnd ? (
                    <FieldError id={sourceEndErrorId}>
                      {fieldErrors.sourceEnd}
                    </FieldError>
                  ) : null}
                </div>
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
                          clearValidationErrors();
                        }}
                        disabled={isBusy || retryLocked}
                        className="whitespace-nowrap rounded-md border border-border-subtle px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus active:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-brand-focus aria-pressed:bg-brand-fill/[0.06] [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
                      >
                        {translate(TARGET_MODE_KEYS[mode])}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {targetMode === "existing" ? (
                  <div className="grid gap-1.5">
                    <label
                      htmlFor={existingTargetInputId}
                      className="text-xs font-medium text-muted-foreground"
                    >
                      {translate("targetChoice")}
                    </label>
                    <select
                      id={existingTargetInputId}
                      data-testid="sprint-rollover-existing-target"
                      value={targetId}
                      onChange={(event) => {
                        setTargetId(event.target.value);
                        clearFieldError("existingTarget");
                      }}
                      aria-describedby={
                        fieldErrors.existingTarget
                          ? existingTargetErrorId
                          : undefined
                      }
                      aria-invalid={Boolean(fieldErrors.existingTarget)}
                      aria-required
                      disabled={isBusy || retryLocked}
                      className="h-8 rounded-md border border-border bg-surface-elevated px-2 text-sm text-foreground focus:border-brand-focus focus:outline-none focus:ring-2 focus:ring-brand-focus disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
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
                    {fieldErrors.existingTarget ? (
                      <FieldError id={existingTargetErrorId}>
                        {fieldErrors.existingTarget}
                      </FieldError>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid gap-3 rounded-md border border-border-subtle p-3">
                    <div className="grid gap-1.5">
                      <label
                        htmlFor={targetNameInputId}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {translate("targetName")}
                      </label>
                      <Input
                        data-testid="sprint-rollover-target-name"
                        id={targetNameInputId}
                        value={targetName}
                        onChange={(event) => {
                          setTargetName(event.target.value);
                          clearFieldError("targetName");
                        }}
                        aria-describedby={
                          fieldErrors.targetName ? targetNameErrorId : undefined
                        }
                        aria-invalid={Boolean(fieldErrors.targetName)}
                        aria-required
                        disabled={isBusy || retryLocked}
                        className="[@media(pointer:coarse)]:min-h-11 disabled:cursor-not-allowed"
                      />
                      {fieldErrors.targetName ? (
                        <FieldError id={targetNameErrorId}>
                          {fieldErrors.targetName}
                        </FieldError>
                      ) : null}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <label
                          htmlFor={targetStartInputId}
                          className="text-xs font-medium text-muted-foreground"
                        >
                          {translate("targetStartLabel")}
                        </label>
                        <DatePickerField
                          id={targetStartInputId}
                          label={translate("targetStart")}
                          value={targetStartDate}
                          onChange={(value) => {
                            targetDatesAreSuggested.current = false;
                            setTargetStartDate(value);
                            clearFieldError("targetStart");
                          }}
                          ariaDescribedBy={
                            fieldErrors.targetStart
                              ? targetStartErrorId
                              : undefined
                          }
                          ariaInvalid={Boolean(fieldErrors.targetStart)}
                          ariaRequired
                          triggerClassName="[@media(pointer:coarse)]:min-h-11 disabled:cursor-not-allowed"
                          disabled={isBusy || retryLocked}
                          clearable={false}
                        />
                        {fieldErrors.targetStart ? (
                          <FieldError id={targetStartErrorId}>
                            {fieldErrors.targetStart}
                          </FieldError>
                        ) : null}
                      </div>
                      <div className="grid gap-1.5">
                        <label
                          htmlFor={targetEndInputId}
                          className="text-xs font-medium text-muted-foreground"
                        >
                          {translate("targetEndLabel")}
                        </label>
                        <DatePickerField
                          id={targetEndInputId}
                          label={translate("targetEnd")}
                          value={targetEndDate}
                          onChange={(value) => {
                            targetDatesAreSuggested.current = false;
                            setTargetEndDate(value);
                            clearFieldError("targetEnd");
                          }}
                          ariaDescribedBy={
                            fieldErrors.targetEnd ? targetEndErrorId : undefined
                          }
                          ariaInvalid={Boolean(fieldErrors.targetEnd)}
                          ariaRequired
                          triggerClassName="[@media(pointer:coarse)]:min-h-11 disabled:cursor-not-allowed"
                          disabled={isBusy || retryLocked}
                          clearable={false}
                          align="end"
                        />
                        {fieldErrors.targetEnd ? (
                          <FieldError id={targetEndErrorId}>
                            {fieldErrors.targetEnd}
                          </FieldError>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {showResult ? (
                <section
                  data-testid="sprint-rollover-result"
                  role="alert"
                  className="grid gap-3 rounded-md border border-status-in-progress-focus/40 bg-status-in-progress-fill/5 p-3"
                >
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      {translate("partialTitle")}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {translate("partialDescription")}
                    </p>
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
                      {translate("conflicts", {
                        count: result.counts.conflicts,
                      })}
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
                      onClick={() => onOpenChange(false)}
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
          )}
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
  stacked = false,
  featured = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
  stacked?: boolean;
  featured?: boolean;
}) {
  return (
    <div
      className={
        featured
          ? "grid min-w-0 gap-0.5 border-b border-border-subtle pb-2"
          : stacked
            ? "grid min-w-0 gap-0.5 px-2 first:pl-0 last:pr-0"
            : "flex min-w-0 items-center justify-between gap-2"
      }
    >
      <dt
        className={
          stacked ? "min-w-0 text-xs text-muted-foreground" : undefined
        }
      >
        {label}
      </dt>
      <dd
        className={
          featured
            ? "text-lg font-semibold text-foreground"
            : strong
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
