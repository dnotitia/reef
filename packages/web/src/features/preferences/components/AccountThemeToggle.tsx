"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "../hooks/useTheme";
import { THEME_OPTIONS } from "../lib/themeOptions";

/**
 * Compact 3-way theme switch for the account menu (REEF-095). Reads and writes
 * the shared theme cursor through `useTheme`, so its selection stays in lockstep
 * with the Settings → Appearance control.
 *
 * It is a `role="group"` of `role="menuitemradio"` buttons (mirroring how this
 * menu's checkbox items use `role="menuitemcheckbox"`). The menu is the native
 * <div>-based dropdown — not Radix — so these plain buttons are Tab-focusable,
 * Enter/Space-activatable, and a click inside the menu does not dismiss it: the
 * menu just closes on an outside mousedown or Escape. That is exactly the
 * "switch theme without the menu closing" behavior AC4 wants.
 */
export function AccountThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: <fieldset> is invalid inside role="menu"; the WAI-ARIA menu pattern groups menuitemradio items under role="group" (mirrors this menu's menuitemcheckbox items).
      role="group"
      aria-label="Theme"
      data-testid="account-theme-toggle"
      className="grid grid-cols-3 gap-1 px-2 py-1"
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const isSelected = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="menuitemradio"
            aria-checked={isSelected}
            aria-label={label}
            title={label}
            data-testid={`account-theme-${value}`}
            onClick={() => void setTheme(value)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-sm border px-1.5 py-1.5 text-[11px] transition-colors duration-150 [touch-action:manipulation]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
              isSelected
                ? "border-brand bg-surface-subtle text-foreground"
                : "border-border text-muted-foreground hover:border-border-subtle hover:bg-surface-hover hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="leading-none">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
