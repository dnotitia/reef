"use client";

import {
  CBX_CHEVRON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "@/components/ui/comboboxChrome";
import { DatePickerField } from "@/components/fields/DatePickerField";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDisplayDate } from "@/features/issues/lib/dateHelpers";
import { cn } from "@/lib/utils";
import {
  ISSUE_DATE_FIELD_REGISTRY,
  getIssueDateField,
  type IssueDateFieldId,
  type IssueDateRange,
  validateIssueDateRange,
} from "@reef/core";
import { Calendar as CalendarIcon, ChevronDown, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

interface IssueDateRangeFilterProps {
  range?: IssueDateRange;
  onChange: (range: IssueDateRange | undefined) => void;
}

type DateRangeMessageKey =
  | "dateRangeFilterLabel"
  | "dateRangeField"
  | "updatedAtRange"
  | "createdAtRange"
  | "startDateRange"
  | "dueDateRange"
  | "updatedAtRangeStart"
  | "updatedAtRangeEnd"
  | "createdAtRangeStart"
  | "createdAtRangeEnd"
  | "startDateRangeStart"
  | "startDateRangeEnd"
  | "dueDateRangeStart"
  | "dueDateRangeEnd"
  | "updatedAtRangeOrder"
  | "updatedAtRangeEditorStart"
  | "updatedAtRangeEditorEnd"
  | "updatedAtRangeEndPlaceholder"
  | "updatedAtRangeStartPlaceholder"
  | "updatedAtRangeEditorClear"
  | "clearDateRange"
  | "updatedAtRangeStartRequired"
  | "updatedAtRangeStartInvalid"
  | "updatedAtRangeEndRequired"
  | "updatedAtRangeEndInvalid";

type DateRangeFieldCopy = {
  label: DateRangeMessageKey;
  from: DateRangeMessageKey;
  to: DateRangeMessageKey;
};

const DATE_RANGE_FIELD_COPY = {
  updated_at: {
    label: "updatedAtRange",
    from: "updatedAtRangeStart",
    to: "updatedAtRangeEnd",
  },
  created_at: {
    label: "createdAtRange",
    from: "createdAtRangeStart",
    to: "createdAtRangeEnd",
  },
  start_date: {
    label: "startDateRange",
    from: "startDateRangeStart",
    to: "startDateRangeEnd",
  },
  due_date: {
    label: "dueDateRange",
    from: "dueDateRangeStart",
    to: "dueDateRangeEnd",
  },
} as const satisfies Record<IssueDateFieldId, DateRangeFieldCopy>;

const DATE_RANGE_FIELD_IDS = Object.keys(
  ISSUE_DATE_FIELD_REGISTRY,
) as IssueDateFieldId[];

function isIssueDateFieldId(value: string): value is IssueDateFieldId {
  return getIssueDateField(value) !== undefined;
}

function errorMessage(
  code: "from_required" | "from_invalid" | "to_required" | "to_invalid",
  t: (key: DateRangeMessageKey) => string,
): string {
  switch (code) {
    case "from_required":
      return t("updatedAtRangeStartRequired");
    case "from_invalid":
      return t("updatedAtRangeStartInvalid");
    case "to_required":
      return t("updatedAtRangeEndRequired");
    case "to_invalid":
      return t("updatedAtRangeEndInvalid");
  }
}

export function IssueDateRangeFilter({
  range,
  onChange,
}: IssueDateRangeFilterProps) {
  const t = useTranslations("issues.filters");
  const locale = useLocale();
  const selected = useMemo<IssueDateRange>(() => {
    const field =
      range && isIssueDateFieldId(range.field) ? range.field : "updated_at";
    return range && field === range.field ? range : { field, from: "", to: "" };
  }, [range]);
  const copy = DATE_RANGE_FIELD_COPY[selected.field as IssueDateFieldId];
  const fieldLabel = t(copy.label);
  const validation =
    range && isIssueDateFieldId(range.field)
      ? validateIssueDateRange(selected)
      : {
          valid: true,
          field: null,
          from: null,
          to: null,
          order: null,
        };
  const fromError = validation.from
    ? errorMessage(validation.from, t)
    : undefined;
  const toError = validation.to
    ? errorMessage(validation.to, t)
    : validation.order
      ? t("updatedAtRangeOrder")
      : undefined;
  const hasSelection = Boolean(selected.from || selected.to);
  const startSummary = selected.from
    ? formatDisplayDate(selected.from, locale)
    : t("updatedAtRangeStartPlaceholder");
  const endSummary = selected.to
    ? formatDisplayDate(selected.to, locale)
    : t("updatedAtRangeEndPlaceholder");
  const summary = hasSelection
    ? `${fieldLabel} · ${startSummary} → ${endSummary}`
    : fieldLabel;

  const updateField = useCallback(
    (field: IssueDateFieldId) => {
      onChange({ ...selected, field });
    },
    [onChange, selected],
  );

  const updateBound = useCallback(
    (bound: "from" | "to", value: string) => {
      const next = { ...selected, [bound]: value } satisfies IssueDateRange;
      onChange(next.from || next.to ? next : undefined);
    },
    [onChange, selected],
  );

  return (
    <div
      className="w-fit max-w-full min-w-0"
      data-testid="updated-at-filter"
      role="group"
      aria-label={t("dateRangeFilterLabel", { field: fieldLabel })}
      data-active={hasSelection ? "true" : undefined}
      data-invalid={fromError || toError ? "true" : undefined}
      data-field={selected.field}
    >
      <Popover className="w-fit max-w-full">
        <div className="inline-flex min-w-0 max-w-full items-stretch">
          <PopoverTrigger
            aria-label={summary}
            data-testid="updated-at-filter-trigger"
            data-active={hasSelection ? "true" : undefined}
            className={cn(
              CBX_TRIGGER_CHIP,
              hasSelection
                ? CBX_TRIGGER_CHIP_ACTIVE
                : CBX_TRIGGER_CHIP_INACTIVE,
              "min-w-0 max-w-full flex-1 justify-between whitespace-nowrap",
              hasSelection && "rounded-r-none border-r-0",
            )}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <CalendarIcon
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span
                className="min-w-0 truncate"
                data-testid="updated-at-filter-summary"
              >
                {summary}
              </span>
            </span>
            <ChevronDown className={CBX_CHEVRON} aria-hidden="true" />
          </PopoverTrigger>
          {hasSelection ? (
            <button
              type="button"
              aria-label={t("clearDateRange", { field: fieldLabel })}
              title={t("clearDateRange", { field: fieldLabel })}
              data-testid="updated-at-range-clear"
              onClick={(event) => {
                event.stopPropagation();
                onChange(undefined);
              }}
              className={cn(
                CBX_TRIGGER_CHIP,
                CBX_TRIGGER_CHIP_ACTIVE,
                "size-8 shrink-0 justify-center rounded-l-none border-l-0 px-0",
              )}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <PopoverContent
          role="dialog"
          aria-labelledby="updated-at-range-editor-label"
          align="end"
          data-testid="updated-at-range-editor"
          className="w-[min(24rem,calc(100vw-5rem))] max-w-[calc(100vw-5rem)] p-3"
        >
          <div
            id="updated-at-range-editor-label"
            className="mb-3 flex items-center gap-2 border-b border-border-subtle pb-2"
            data-testid="updated-at-range-editor-criterion"
          >
            <CalendarIcon
              className="h-3.5 w-3.5 shrink-0 text-brand-text"
              aria-hidden="true"
            />
            <span className="type-control font-medium text-foreground">
              {fieldLabel}
            </span>
          </div>

          <div className="mb-3 min-w-0">
            <label
              htmlFor="issue-date-range-field"
              className="mb-1 block type-caption font-medium text-foreground"
            >
              {t("dateRangeField")}
            </label>
            <div className="relative min-w-0">
              <select
                id="issue-date-range-field"
                aria-label={t("dateRangeField")}
                data-testid="issue-date-range-field"
                value={selected.field}
                onChange={(event) => {
                  const field = event.target.value;
                  if (isIssueDateFieldId(field)) updateField(field);
                }}
                className="h-8 w-full min-w-0 appearance-none rounded-md border border-border bg-surface-elevated px-2.5 pr-8 type-control text-foreground outline-none transition-colors duration-150 hover:bg-surface-hover focus-visible:border-brand-focus focus-visible:ring-2 focus-visible:ring-brand-focus/30"
              >
                {DATE_RANGE_FIELD_IDS.map((field) => (
                  <option key={field} value={field}>
                    {t(DATE_RANGE_FIELD_COPY[field].label)}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          </div>

          <div
            className="grid min-w-0 grid-cols-2 gap-3 max-[480px]:grid-cols-1"
            data-testid="updated-at-range-editor-fields"
          >
            <div className="min-w-0">
              <label
                htmlFor="updated-at-range-start"
                className="mb-1 block type-caption font-medium text-foreground"
                data-testid="updated-at-range-start-label"
              >
                {t("updatedAtRangeEditorStart")}
              </label>
              <DatePickerField
                value={selected.from}
                onChange={(value) => updateBound("from", value)}
                label={t(copy.from)}
                placeholder={t("updatedAtRangeStartPlaceholder")}
                id="updated-at-range-start"
                clearable={false}
                ariaDescribedBy={
                  fromError ? "updated-at-range-start-error" : undefined
                }
                ariaInvalid={Boolean(fromError)}
              />
              {fromError ? (
                <p
                  className="mt-1 max-w-full text-[0.6875rem] leading-4 text-destructive-text"
                  data-testid="updated-at-range-start-error"
                  role="alert"
                >
                  {fromError}
                </p>
              ) : null}
            </div>
            <div className="min-w-0">
              <label
                htmlFor="updated-at-range-end"
                className="mb-1 block type-caption font-medium text-foreground"
                data-testid="updated-at-range-end-label"
              >
                {t("updatedAtRangeEditorEnd")}
              </label>
              <DatePickerField
                value={selected.to}
                onChange={(value) => updateBound("to", value)}
                label={t(copy.to)}
                placeholder={t("updatedAtRangeEndPlaceholder")}
                id="updated-at-range-end"
                clearable={false}
                ariaDescribedBy={
                  toError ? "updated-at-range-end-error" : undefined
                }
                ariaInvalid={Boolean(toError)}
              />
              {toError ? (
                <p
                  className="mt-1 max-w-full text-[0.6875rem] leading-4 text-destructive-text"
                  data-testid="updated-at-range-end-error"
                  role="alert"
                >
                  {toError}
                </p>
              ) : null}
            </div>
          </div>

          {hasSelection ? (
            <div className="mt-3 flex justify-end border-t border-border-subtle pt-2">
              <button
                type="button"
                onClick={() => onChange(undefined)}
                data-testid="updated-at-range-editor-clear"
                className="rounded-md px-2 py-1 type-caption font-medium text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus/30"
              >
                {t("updatedAtRangeEditorClear")}
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}
