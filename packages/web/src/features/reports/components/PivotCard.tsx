"use client";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  useFieldNameLabels,
  useIssueTypeLabels,
  usePriorityLabels,
  useSeverityLabels,
  useStatusLabels,
} from "@/i18n/fieldLabels";
import type { IssueListItem } from "@reef/core";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import type { ReportFilters } from "../lib/aggregate";
import {
  PIVOT_FIELD_KEYS,
  type PivotFieldKey,
  type PivotValueLabels,
  computePivot,
} from "../lib/pivot";
import { PivotMatrix } from "./ReportCharts";
import { Card } from "./ReportLayout";

/**
 * Custom 2-D pivot card (REEF-189). The PM picks any two categorical fields for
 * the rows and columns and sees a count-based crosstab — the "ask any cross
 * without shipping a new card" surface. Axis selection is local card state: the
 * pivot is a recomputed view of the already-loaded issues (a single client
 * pass), not a persisted dashboard, so it needs no URL/store wiring (Notes:
 * persistence is a later question).
 */
export function PivotCard({
  issues,
  filters,
}: {
  issues: ReadonlyArray<IssueListItem>;
  filters: ReportFilters;
}) {
  const [rowField, setRowField] = useState<PivotFieldKey>("assignee");
  const [colField, setColField] = useState<PivotFieldKey>("status");
  const t = useTranslations("reports.cards");

  // Pivot axis FIELD names follow the locale (REEF-304). Every pivot field is a
  // core field-registry name, so resolve them through the shared field-name
  // catalog instead of the hardcoded English `PIVOT_FIELD_LABELS` map.
  const fieldNames = useFieldNameLabels();
  const fieldLabels = useMemo<Record<PivotFieldKey, string>>(
    () => ({
      status: fieldNames.status,
      type: fieldNames.type,
      priority: fieldNames.priority,
      severity: fieldNames.severity,
      assignee: fieldNames.assignee,
      label: fieldNames.labels,
    }),
    [fieldNames],
  );

  // The enum-axis value labels resolve in the active locale (REEF-292); each
  // hook is memoized per locale, so this bundle is a stable `computePivot` dep.
  const statusLabels = useStatusLabels();
  const issueTypeLabels = useIssueTypeLabels();
  const priorityLabels = usePriorityLabels();
  const severityLabels = useSeverityLabels();
  const labels: PivotValueLabels = useMemo(
    () => ({
      status: statusLabels,
      type: issueTypeLabels,
      priority: priorityLabels,
      severity: severityLabels,
    }),
    [statusLabels, issueTypeLabels, priorityLabels, severityLabels],
  );

  const result = useMemo(
    () => computePivot(issues, rowField, colField, labels, { filters }),
    [issues, rowField, colField, labels, filters],
  );

  // Disclose any dynamic-axis cap instead of silently truncating it away. Each
  // note is a localized "{n} {field} values"; the two are joined with a locale
  // conjunction so the Korean sentence stays whole (REEF-304).
  const foldedParts: string[] = [];
  if (result.rowsFolded > 0) {
    foldedParts.push(
      t("foldValues", {
        count: result.rowsFolded,
        field: fieldLabels[rowField].toLowerCase(),
      }),
    );
  }
  if (result.colsFolded > 0) {
    foldedParts.push(
      t("foldValues", {
        count: result.colsFolded,
        field: fieldLabels[colField].toLowerCase(),
      }),
    );
  }
  const foldedText =
    foldedParts.length === 2
      ? t("foldedAnd", { a: foldedParts[0], b: foldedParts[1] })
      : (foldedParts[0] ?? "");

  return (
    <Card title={t("pivot")} subtitle={t("pivotSubtitle")}>
      <div
        data-testid="pivot-controls"
        className="flex flex-wrap items-center gap-2"
      >
        <FieldPicker
          label={t("rows")}
          value={rowField}
          exclude={colField}
          onChange={setRowField}
          fieldLabels={fieldLabels}
          testId="pivot-row-field"
        />
        <span
          aria-hidden="true"
          className="px-0.5 text-sm text-muted-foreground"
        >
          ×
        </span>
        <FieldPicker
          label={t("columns")}
          value={colField}
          exclude={rowField}
          onChange={setColField}
          fieldLabels={fieldLabels}
          testId="pivot-col-field"
        />
      </div>
      <PivotMatrix result={result} />
      {foldedText && (
        <p className="text-[11px] text-muted-foreground">
          {t("foldedNote", { folded: foldedText })}
        </p>
      )}
    </Card>
  );
}

function FieldPicker({
  label,
  value,
  exclude,
  onChange,
  fieldLabels,
  testId,
}: {
  label: string;
  value: PivotFieldKey;
  /** The field chosen on the other axis — hidden here so rows and columns can
   *  is not the same field. */
  exclude: PivotFieldKey;
  onChange: (value: PivotFieldKey) => void;
  /** Locale-resolved field-name labels, keyed by pivot field (REEF-304). */
  fieldLabels: Record<PivotFieldKey, string>;
  testId: string;
}) {
  const t = useTranslations("reports.cards");
  const options: ComboboxOption<PivotFieldKey>[] = PIVOT_FIELD_KEYS.filter(
    (key) => key !== exclude,
  ).map((key) => ({
    value: key,
    label: fieldLabels[key],
    content: fieldLabels[key],
    testId: `${testId}-option-${key}`,
  }));
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Combobox<PivotFieldKey>
        ariaLabel={t("fieldPickerAria", { label })}
        value={value}
        onChange={(next) => {
          if (next) onChange(next);
        }}
        options={options}
        testId={testId}
        triggerTestId={`${testId}-trigger`}
      />
    </div>
  );
}
