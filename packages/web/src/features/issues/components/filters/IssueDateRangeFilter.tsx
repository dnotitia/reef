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

  const updateBound = useCallback(
    (bound: "from" | "to", value: string) => {
      const next = { ...selected, [bound]: value } satisfies IssueDateRange;
      onChange(next.from || next.to ? next : undefined);
    },
    [onChange, selected],
  );

  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-start gap-1.5"
      data-testid="updated-at-filter"
      role="group"
      aria-label={t("updatedAtRange")}
      data-invalid={fromError || toError ? "true" : undefined}
    >
      <div className="w-[9.5rem] max-w-full">
        <DatePickerField
          value={selected.from}
          onChange={(value) => updateBound("from", value)}
          label={t("updatedAtRangeStart")}
          placeholder={t("updatedAtRangeStartPlaceholder")}
          id="updated-at-range-start"
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
        className="mt-2.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      >
        –
      </span>
      <div className="w-[9.5rem] max-w-full">
        <DatePickerField
          value={selected.to}
          onChange={(value) => updateBound("to", value)}
          label={t("updatedAtRangeEnd")}
          placeholder={t("updatedAtRangeEndPlaceholder")}
          id="updated-at-range-end"
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
  );
}
