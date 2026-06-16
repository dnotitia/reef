"use client";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { useIssueTemplates } from "@/features/settings/hooks/useIssueTemplates";
import type { Template } from "@reef/core";
import { FileText } from "lucide-react";
import { useMemo } from "react";

interface TemplatePickerProps {
  /** akb vault name. Empty string disables the picker. */
  vault: string;
  /**
   * Invoked with the selected template. The parent (NewIssueDialog) decides
   * how to merge: today it overwrites title prefix + body, preselects priority,
   * and replaces labels. We don't prompt for confirmation when there's existing
   * content — the user clicked the template explicitly.
   */
  onSelect: (template: Template) => void;
  disabled?: boolean;
}

/**
 * Template picker shown in the `<NewIssueDialog>` header, beside the Enrich
 * action. Built on the shared `<Combobox>` primitive (REEF-135) in its action
 * (button) variant — an apply action rather than a persisted value, so it shows
 * no selected state. Templates come from `.reef/templates/*.md` via the shared
 * `useIssueTemplates` query (same cache as Settings → Templates).
 */
export function TemplatePicker({
  vault,
  onSelect,
  disabled,
}: TemplatePickerProps) {
  const query = useIssueTemplates(vault);
  const templates = useMemo(() => query.data?.templates ?? [], [query.data]);
  const triggerDisabled = disabled || vault.length === 0;

  const options = useMemo<ComboboxOption<string>[]>(
    () =>
      templates.map((template) => ({
        value: template.name,
        label: template.label,
        keywords: template.description,
        content: (
          <>
            <span className="text-[13px] font-medium text-foreground">
              {template.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {template.description}
            </span>
          </>
        ),
      })),
    [templates],
  );

  return (
    <Combobox<string>
      triggerVariant="button"
      triggerTestId="template-picker-trigger"
      ariaLabel="Apply issue template"
      value={null}
      onChange={(name) => {
        const template = templates.find((t) => t.name === name);
        if (template) onSelect(template);
      }}
      options={options}
      loading={query.isPending}
      disabled={triggerDisabled}
      triggerContent={
        <>
          <FileText className="h-3.5 w-3.5" />
          <span>Template</span>
        </>
      }
      align="end"
      contentClassName="w-72"
      optionClassName="flex flex-col items-start gap-0.5"
      emptyState="No templates defined yet. Add one in Settings → Templates."
    />
  );
}
