"use client";

import { AssigneeCombobox } from "@/components/AssigneeCombobox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { LabelChipInput } from "@/components/ui/label-chip-input";
import {
  formatLabelFilter,
  parseLabelFilter,
} from "@/features/issues/lib/issueListUtils";
import { PlanningItemCombobox } from "@/features/planning/components/PlanningItemCombobox";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useFieldNameLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { DEFAULT_REPORT_FILTERS, type ReportFilters } from "../lib/aggregate";
import { useReportPeriodLabels } from "../lib/useReportPeriodLabels";

/**
 * Reports scope bar. Period and scope are reports; the remaining facets
 * (sprint/milestone/release/assignee/label) reuse the exact issue-filter leaves
 * from `/issues` so the two surfaces share one UI and one matching contract
 * (REEF-074). Filter state stays local to reports — it does not touches the issues
 * Zustand store, URL sync, or IndexedDB persistence.
 */
export function ReportScopeBar({
  filters,
  onChange,
}: {
  filters: ReportFilters;
  onChange: (filters: ReportFilters) => void;
}) {
  const { vault } = useActiveVault();
  const fieldNames = useFieldNameLabels();
  const t = useTranslations("reports.page");
  const periodLabels = useReportPeriodLabels();
  const patch = (next: Partial<ReportFilters>) =>
    onChange({ ...filters, ...next });

  // Period option labels follow the active locale (REEF-304), so they are built
  // here — memoized on the stable label record — rather than hoisted to module
  // scope. The control and the Throughput-card window subtitle read the same
  // localized labels so they name the window identically (REEF-185).
  const periodOptions = useMemo<
    ReadonlyArray<{ value: ReportFilters["period"]; label: string }>
  >(
    () =>
      (["4w", "12w", "quarter", "all"] as const).map((value) => ({
        value,
        label: periodLabels[value],
      })),
    [periodLabels],
  );

  const labelValues = useMemo(
    () => parseLabelFilter(filters.label),
    [filters.label],
  );

  // Scope and Measure carry localized labels, so they are built here (memoized
  // on the stable translator) rather than hoisted to module scope. Measure
  // weights the load/throughput distributions by issue count (default) or summed
  // story points (REEF-188); it rides alongside Period/Scope as a report
  // control, not a population facet.
  const scopeOptions = useMemo<
    ReadonlyArray<{ value: ReportFilters["scope"]; label: string }>
  >(
    () => [
      { value: "active", label: t("scopeActive") },
      { value: "all", label: t("scopeAll") },
      { value: "completed", label: t("scopeCompleted") },
    ],
    [t],
  );
  const measureOptions = useMemo<
    ReadonlyArray<{ value: ReportFilters["measure"]; label: string }>
  >(
    () => [
      { value: "count", label: t("measureCount") },
      { value: "points", label: t("measurePoints") },
    ],
    [t],
  );

  return (
    <div
      data-testid="report-scope-bar"
      className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(13rem,100%),1fr))] gap-2 rounded-lg border border-border-subtle bg-surface-subtle p-2"
    >
      <ScopeSelect
        label={t("period")}
        value={filters.period}
        options={periodOptions}
        active={filters.period !== DEFAULT_REPORT_FILTERS.period}
        onChange={(period) =>
          patch({ period: period as ReportFilters["period"] })
        }
      />
      <ScopeSelect
        label={t("scope")}
        value={filters.scope}
        options={scopeOptions}
        active={filters.scope !== DEFAULT_REPORT_FILTERS.scope}
        onChange={(scope) => patch({ scope: scope as ReportFilters["scope"] })}
      />
      <ScopeSelect
        label={t("measure")}
        value={filters.measure}
        options={measureOptions}
        active={filters.measure !== DEFAULT_REPORT_FILTERS.measure}
        onChange={(measure) =>
          patch({ measure: measure as ReportFilters["measure"] })
        }
      />
      <div className="min-w-0">
        <PlanningItemCombobox
          kind="sprints"
          vault={vault}
          value={filters.sprint_id ?? ""}
          onChange={(id) => patch({ sprint_id: id || undefined })}
          label={fieldNames.sprint}
          placeholder={fieldNames.sprint}
          emptyLabel={t("anySprint")}
          testId="report-sprint-input"
          active={Boolean(filters.sprint_id)}
        />
      </div>
      <div className="min-w-0">
        <PlanningItemCombobox
          kind="milestones"
          vault={vault}
          value={filters.milestone_id ?? ""}
          onChange={(id) => patch({ milestone_id: id || undefined })}
          label={fieldNames.milestone}
          placeholder={fieldNames.milestone}
          emptyLabel={t("anyMilestone")}
          testId="report-milestone-input"
          active={Boolean(filters.milestone_id)}
        />
      </div>
      <div className="min-w-0">
        <PlanningItemCombobox
          kind="releases"
          vault={vault}
          value={filters.release_id ?? ""}
          onChange={(id) => patch({ release_id: id || undefined })}
          label={fieldNames.release}
          placeholder={fieldNames.release}
          emptyLabel={t("anyRelease")}
          testId="report-release-input"
          active={Boolean(filters.release_id)}
        />
      </div>
      <div className="min-w-0" data-testid="report-assignee-filter">
        <AssigneeCombobox
          value={filters.assignee ?? ""}
          onChange={(login) => patch({ assignee: login || undefined })}
          vault={vault}
          label={fieldNames.assignee}
          placeholder={fieldNames.assignee}
          emptyLabel={t("anyAssignee")}
          active={Boolean(filters.assignee)}
        />
      </div>
      <div className="min-w-0">
        <LabelChipInput
          value={labelValues}
          onChange={(labels) => patch({ label: formatLabelFilter(labels) })}
          ariaLabel={fieldNames.labels}
          placeholder={fieldNames.labels}
          data-testid="report-label-input"
        />
      </div>
    </div>
  );
}

function ScopeSelect({
  label,
  value,
  options,
  active,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  active?: boolean;
  onChange: (value: string) => void;
}) {
  // Period/Scope are static enums on the shared combobox primitive, so they
  // render on the same field trigger as the reused sprint/assignee combos.
  // Their defaults are the report baseline; just non-default values should read
  // as an active filter affordance (REEF-153).
  const comboOptions: ComboboxOption<string>[] = options.map((option) => ({
    value: option.value,
    label: option.label,
    content: option.label,
  }));
  return (
    <div className="min-w-0">
      <Combobox<string>
        ariaLabel={label}
        value={value || null}
        onChange={(next) => onChange(next ?? "")}
        options={comboOptions}
        active={active}
      />
    </div>
  );
}
