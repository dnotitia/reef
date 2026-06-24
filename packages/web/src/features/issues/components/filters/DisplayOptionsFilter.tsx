"use client";

import type { ComboboxOption } from "@/components/ui/combobox";
import { MultiSelectCombobox } from "@/components/ui/multi-select-combobox";
import type { IssueFilter } from "@/features/issues/stores/useIssueStore";
import { Archive, CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The "Display" view-mode toggles (REEF-275), modeled as a multi-select facet so
 * they reuse the same `MultiSelectCombobox` chrome (panel, glyph+label row,
 * trailing brand Check, chip trigger) as sibling facets in this bar rather than
 * a bespoke popover. Each toggle maps to one boolean filter flag (`archived` to
 * `showArchived`, `completed` to `showStale`); "selected" means the flag is on.
 * Glyph-aligned with the facet rows; the primitive adds the trailing selection
 * Check itself, so the leading glyph is the value mark.
 */
type ViewModeKey = "archived" | "completed";

interface DisplayOptionsFilterProps {
  backlogScope: boolean;
  filter: Pick<IssueFilter, "showArchived" | "showStale">;
  setFilter: (patch: Partial<IssueFilter>) => void;
}

export function DisplayOptionsFilter({
  backlogScope,
  filter,
  setFilter,
}: DisplayOptionsFilterProps) {
  const t = useTranslations("issues.filters");

  // Built per-render so the option labels resolve to the active locale (REEF-298).
  const viewModeOptions: ComboboxOption<ViewModeKey>[] = [
    {
      value: "archived",
      label: t("showArchived"),
      content: (
        <>
          <Archive
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {t("showArchived")}
        </>
      ),
      testId: "show-archived-toggle",
    },
    {
      value: "completed",
      label: t("showCompleted"),
      content: (
        <>
          <CircleCheck
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {t("showCompleted")}
        </>
      ),
      testId: "show-stale-toggle",
    },
  ];

  const values: ViewModeKey[] = [];
  if (filter.showArchived) values.push("archived");
  if (filter.showStale) values.push("completed");
  const options = backlogScope ? viewModeOptions.slice(0, 1) : viewModeOptions;

  return (
    <MultiSelectCombobox
      label={t("display")}
      values={values}
      onToggle={(value, checked) =>
        setFilter(
          value === "archived"
            ? { showArchived: checked || undefined }
            : { showStale: checked || undefined },
        )
      }
      options={options}
      active={Boolean(filter.showArchived || filter.showStale)}
      ariaLabel={t("displayOptions")}
      triggerTestId="display-options-trigger"
      contentTestId="display-options-content"
    />
  );
}
