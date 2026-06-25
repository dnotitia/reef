"use client";

import { PlanningStatusBadge } from "@/components/fields/PlanningStatusBadge";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { usePlanningKindSingularLabels } from "@/i18n/fieldLabels";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { usePlanningCatalog } from "../hooks/usePlanningCatalog";
import {
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
  panelClassName?: string;
  testId?: string;
  /** Filter affordance — paints the brand ring when set (filter surfaces just). */
  active?: boolean;
}

export const PLANNING_ITEM_PANEL_CLASS = "min-w-[min(20rem,90vw)]";

/**
 * Sprint / milestone / release selector on the shared `<Combobox>` primitive
 * (REEF-135). The planning catalog is a short static list, so the control is a
 * plain (non-searchable) select with type-ahead. Planning names are often
 * longer than compact filter triggers, so the opened panel keeps a readable
 * floor while still capping itself to narrow viewports.
 */
export function PlanningItemCombobox({
  kind,
  vault,
  value,
  onChange,
  id,
  label,
  placeholder,
  emptyLabel,
  disabled,
  assignableOnly = false,
  className,
  panelClassName = PLANNING_ITEM_PANEL_CLASS,
  testId,
  active,
}: PlanningItemComboboxProps) {
  // Kind copy resolves in the active locale (REEF-292); the optional props still
  // override it. Hooks can not run in default-parameter position, so the
  // fallbacks are computed in the body. The "Select/No {kind}" wrappers are
  // catalog-owned so each locale keeps word order (REEF-309) — never assemble an
  // English prefix around the localized kind word.
  const t = useTranslations("components.planningItem");
  const singular = usePlanningKindSingularLabels()[kind];
  const resolvedLabel = label ?? singular;
  const resolvedPlaceholder = placeholder ?? t("select", { kind: singular });
  const resolvedEmptyLabel = emptyLabel ?? t("none", { kind: singular });
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
      placeholder={resolvedPlaceholder}
      renderValue={() => (
        <span className="truncate">{selected?.name ?? value}</span>
      )}
      noneOption={{ label: resolvedEmptyLabel }}
      emptyState={t("empty")}
      disabled={disabled || !vault}
      active={active}
      ariaLabel={
        value ? `${resolvedLabel}: ${selected?.name ?? value}` : resolvedLabel
      }
      contentClassName={panelClassName}
    />
  );
}
