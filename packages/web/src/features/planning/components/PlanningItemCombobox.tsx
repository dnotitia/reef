"use client";

import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useMemo } from "react";
import { usePlanningCatalog } from "../hooks/usePlanningCatalog";
import {
  PLANNING_KIND_SINGULAR,
  type PlanningKind,
  isAssignablePlanningItem,
  itemsForKind,
} from "../lib/planningItems";

interface PlanningItemComboboxProps {
  kind: PlanningKind;
  vault: string;
  value: string;
  onChange: (id: string) => void;
  id?: string;
  label?: string;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  assignableOnly?: boolean;
  className?: string;
  testId?: string;
  /** Filter affordance — paints the brand ring when set (filter surfaces just). */
  active?: boolean;
}

/**
 * Sprint / milestone / release selector on the shared `<Combobox>` primitive
 * (REEF-135). The planning catalog is a short static list, so the control is a
 * plain (non-searchable) select with type-ahead.
 */
export function PlanningItemCombobox({
  kind,
  vault,
  value,
  onChange,
  id,
  label = PLANNING_KIND_SINGULAR[kind],
  placeholder = `Select ${PLANNING_KIND_SINGULAR[kind].toLowerCase()}`,
  emptyLabel = `No ${PLANNING_KIND_SINGULAR[kind].toLowerCase()}`,
  disabled,
  assignableOnly = false,
  className,
  testId,
  active,
}: PlanningItemComboboxProps) {
  const { data: catalog, isPending } = usePlanningCatalog(vault);
  const items = itemsForKind(catalog, kind);
  const selected = items.find((item) => item.id === value);
  const visibleItems = useMemo(() => {
    if (!assignableOnly) return items;
    return items.filter(
      (item) => isAssignablePlanningItem(kind, item) || item.id === value,
    );
  }, [assignableOnly, items, kind, value]);

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      visibleItems.map((item) => ({
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
    [visibleItems, kind],
  );

  return (
    <Combobox<string>
      className={className}
      id={id}
      triggerTestId={testId}
      value={value || null}
      onChange={(v) => onChange(v ?? "")}
      options={options}
      loading={isPending}
      placeholder={placeholder}
      renderValue={() => (
        <span className="truncate">{selected?.name ?? value}</span>
      )}
      noneOption={{ label: emptyLabel }}
      emptyState="No planning items."
      disabled={disabled || !vault}
      active={active}
      ariaLabel={value ? `${label}: ${selected?.name ?? value}` : label}
    />
  );
}
