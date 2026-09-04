"use client";

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useTheme } from "../hooks/useTheme";
import type { ThemePreference } from "../lib/theme";
import { THEME_OPTIONS } from "../lib/themeOptions";

/**
 * Compact 3-way theme switch for the account menu (REEF-095). Reads and writes
 * the shared theme cursor through `useTheme`, so its selection stays in lockstep
 * with the Settings → Appearance control.
 *
 * It is a shared `DropdownMenuRadioGroup`, so the theme choices participate in
 * the same roving-focus and focus-restoration contract as the rest of the
 * account menu. Each choice keeps the menu open so a quick switch does not
 * dismiss the account surface.
 */
export function AccountThemeToggle() {
  const t = useTranslations("settings.preferences.appearance");
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenuRadioGroup
      value={theme ?? undefined}
      onValueChange={(value) => void setTheme(value as ThemePreference)}
      aria-label={t("themeLabel")}
      data-testid="account-theme-toggle"
      className="grid grid-cols-3 gap-1 px-2 py-1"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const isSelected = theme === value;
        return (
          <DropdownMenuRadioItem
            key={value}
            aria-label={label}
            keepOpen
            value={value}
            title={label}
            data-testid={`account-theme-${value}`}
            leading={<Icon aria-hidden="true" className="size-3.5" />}
            className={cn(
              "min-h-11 flex-col gap-1 rounded-sm border px-1.5 py-1.5 pr-1.5 type-caption transition-colors duration-150 [touch-action:manipulation]",
              "focus-visible:ring-2 focus-visible:ring-brand-focus",
              isSelected
                ? "border-brand-focus bg-surface-subtle text-foreground"
                : "border-border text-muted-foreground hover:border-border-subtle hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <span className="leading-none">{label}</span>
          </DropdownMenuRadioItem>
        );
      })}
    </DropdownMenuRadioGroup>
  );
}
