"use client";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { IssueListItem } from "@reef/core";
import { useMemo, useState } from "react";
import type { ReportFilters } from "../lib/aggregate";
import {
  PIVOT_FIELD_KEYS,
  PIVOT_FIELD_LABELS,
  type PivotFieldKey,
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

  const result = useMemo(
    () => computePivot(issues, rowField, colField, { filters }),
    [issues, rowField, colField, filters],
  );

  // Disclose any dynamic-axis cap instead of silently truncating it away.
  const folded: string[] = [];
  if (result.rowsFolded > 0) {
    folded.push(foldNote(result.rowsFolded, PIVOT_FIELD_LABELS[rowField]));
  }
  if (result.colsFolded > 0) {
    folded.push(foldNote(result.colsFolded, PIVOT_FIELD_LABELS[colField]));
  }

  return (
    <Card title="Pivot" subtitle="In scope · issue count">
      <div
        data-testid="pivot-controls"
        className="flex flex-wrap items-center gap-2"
      >
        <FieldPicker
          label="Rows"
          value={rowField}
          exclude={colField}
          onChange={setRowField}
          testId="pivot-row-field"
        />
        <span
          aria-hidden="true"
          className="px-0.5 text-sm text-muted-foreground"
        >
          ×
        </span>
        <FieldPicker
          label="Columns"
          value={colField}
          exclude={rowField}
          onChange={setColField}
          testId="pivot-col-field"
        />
      </div>
      <PivotMatrix result={result} />
      {folded.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Top buckets shown; {folded.join(" and ")} folded into an Other bucket.
        </p>
      )}
    </Card>
  );
}

function foldNote(count: number, fieldLabel: string): string {
  const noun = fieldLabel.toLowerCase();
  return `${count} ${noun} value${count === 1 ? "" : "s"}`;
}

function FieldPicker({
  label,
  value,
  exclude,
  onChange,
  testId,
}: {
  label: string;
  value: PivotFieldKey;
  /** The field chosen on the other axis — hidden here so rows and columns can
   *  is not the same field. */
  exclude: PivotFieldKey;
  onChange: (value: PivotFieldKey) => void;
  testId: string;
}) {
  const options: ComboboxOption<PivotFieldKey>[] = PIVOT_FIELD_KEYS.filter(
    (key) => key !== exclude,
  ).map((key) => ({
    value: key,
    label: PIVOT_FIELD_LABELS[key],
    content: PIVOT_FIELD_LABELS[key],
    testId: `${testId}-option-${key}`,
  }));
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <Combobox<PivotFieldKey>
        ariaLabel={`${label} field`}
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
