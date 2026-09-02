"use client";

import { DatePickerField } from "@/components/fields/DatePickerField";
import { type IssueDateRange, validateIssueDateRange } from "@reef/core";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";

interface IssueDateRangeFilterProps {
  range?: IssueDateRange;
  onChange: (range: IssueDateRange | undefined) => void;
}

type DateRangeMessageKey =
  | "updatedAtRangeStartRequired"
  | "updatedAtRangeStartInvalid"
  | "updatedAtRangeEndRequired"
  | "updatedAtRangeEndInvalid";

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
  const selected = useMemo(
    () =>
      range?.field === "updated_at"
        ? range
        : { field: "updated_at", from: "", to: "" },
    [range],
  );
  const validation =
    range?.field === "updated_at"
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

  const updateBound = useCallback(
    (bound: "from" | "to", value: string) => {
      const next = { ...selected, [bound]: value } satisfies IssueDateRange;
      onChange(next.from || next.to ? next : undefined);
    },
    [onChange, selected],
  );

  return (
    <div
      className="w-[20rem] max-w-full min-w-0"
      data-testid="updated-at-filter"
      role="group"
      aria-label={t("updatedAtRange")}
      aria-labelledby="updated-at-filter-label"
      data-active={hasSelection ? "true" : undefined}
      data-invalid={fromError || toError ? "true" : undefined}
    >
      <span
        id="updated-at-filter-label"
        className="mb-1 block type-caption font-medium leading-4 text-muted-foreground"
        data-testid="updated-at-filter-label"
      >
        {t("updatedAtRange")}
      </span>
      <div
        className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-1.5 max-[769px]:grid-cols-1"
        data-testid="updated-at-range-controls"
      >
        <div className="min-w-0">
          <DatePickerField
            value={selected.from}
            onChange={(value) => updateBound("from", value)}
            label={t("updatedAtRangeStart")}
            placeholder={t("updatedAtRangeStartPlaceholder")}
            id="updated-at-range-start"
            active={hasSelection}
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
        <span
          className="inline-flex h-8 shrink-0 items-center justify-center text-muted-foreground max-[769px]:h-4 max-[769px]:justify-self-center"
          data-testid="updated-at-range-separator"
          aria-hidden="true"
        >
          –
        </span>
        <div className="min-w-0">
          <DatePickerField
            value={selected.to}
            onChange={(value) => updateBound("to", value)}
            label={t("updatedAtRangeEnd")}
            placeholder={t("updatedAtRangeEndPlaceholder")}
            id="updated-at-range-end"
            active={hasSelection}
            ariaDescribedBy={toError ? "updated-at-range-end-error" : undefined}
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
    </div>
  );
}
