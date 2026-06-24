"use client";

import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import type { ComboboxOption } from "@/components/ui/combobox";
import { MultiSelectCombobox } from "@/components/ui/multi-select-combobox";
import { usePlanningKindSingularLabels } from "@/i18n/fieldLabels";
import { useMemo } from "react";
import { usePlanningCatalog } from "../hooks/usePlanningCatalog";
import { type PlanningKind, itemsForKind } from "../lib/planningItems";
import { PLANNING_ITEM_PANEL_CLASS } from "./PlanningItemCombobox";

interface PlanningItemMultiComboboxProps {
  kind: PlanningKind;
  vault: string;
  /** Currently-selected planning ids (undefined when the facet is unset). */
  values: readonly string[] | undefined;
  /** Reports a row toggle; the caller folds `[] → undefined` for its store. */
  onToggle: (id: string, checked: boolean) => void;
  label?: string;
  /** Filter affordance — paints the brand ring when set. */
  active?: boolean;
  triggerTestId?: string;
  contentTestId?: string;
  className?: string;
  panelClassName?: string;
}

/**
 * Multi-select sprint / release filter (REEF-267) — the multi-select sibling of
 * `PlanningItemCombobox`. The planning catalog is a short static list, so this is
 * a plain (non-searchable) `MultiSelectCombobox`; several ids OR-combine within
 * the facet and the closed trigger shows the shared "(N)" summary. Milestone is
 * deliberately NOT given a multi-select variant (out of scope, REEF-267).
 */
export function PlanningItemMultiCombobox({
  kind,
  vault,
  values,
  onToggle,
  label,
  active,
  triggerTestId,
  contentTestId,
  className,
  panelClassName = PLANNING_ITEM_PANEL_CLASS,
}: PlanningItemMultiComboboxProps) {
  // Kind copy resolves in the active locale (REEF-292); `label` still overrides.
  const singular = usePlanningKindSingularLabels()[kind];
  const resolvedLabel = label ?? singular;
  const { data: catalog, isPending } = usePlanningCatalog(vault);
  const items = useMemo(() => itemsForKind(catalog, kind), [catalog, kind]);

  // Resolve a single selection's opaque id to its name for the trigger summary,
  // so the closed chip reads "Sprint (Sprint 4)" rather than the raw UUID
  // (REEF-246/267). Two or more selections collapse to "(N)" in the primitive.
  const nameById = useMemo(
    () => new Map(items.map((item) => [item.id, item.name])),
    [items],
  );

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      items.map((item) => ({
        value: item.id,
        label: item.name,
        content: (
          <>
            <span className="truncate">{item.name}</span>
            <PlanningStatusBadge
              kind={kind}
              status={item.status}
              className="ml-auto shrink-0"
            />
          </>
        ),
      })),
    [items, kind],
  );

  return (
    <MultiSelectCombobox<string>
      label={resolvedLabel}
      values={values}
      onToggle={onToggle}
      options={options}
      loading={isPending}
      emptyState="No planning items."
      active={active}
      disabled={!vault}
      ariaLabel={resolvedLabel}
      triggerTestId={triggerTestId}
      contentTestId={contentTestId}
      className={className}
      contentClassName={panelClassName}
      summarizeValue={(id) => nameById.get(id) ?? id}
    />
  );
}
