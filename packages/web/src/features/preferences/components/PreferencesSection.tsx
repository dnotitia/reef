"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "../hooks/useTheme";
import { THEME_OPTIONS } from "../lib/themeOptions";

export function PreferencesSection() {
  const { theme, setTheme } = useTheme();

  return (
    <section
      data-testid="preferences-section"
      className="flex flex-col gap-3"
      aria-labelledby="preferences-heading"
    >
      <header className="flex flex-col gap-1">
        <h3
          id="preferences-heading"
          className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          Appearance
        </h3>
        <p className="text-xs text-muted-foreground">
          Choose how reef looks in this browser. The selection persists per
          device.
        </p>
      </header>

      <div
        role="radiogroup"
        aria-labelledby="preferences-heading"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2"
      >
        {THEME_OPTIONS.map((opt) => {
          const isSelected = theme === opt.value;
          const Icon = opt.Icon;
          return (
            <button
              key={opt.value}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: native <input type="radio"> does not host this tile's icon + heading + description layout; ARIA role="radio" inside an explicit radiogroup is the documented WAI-ARIA Authoring Practices alternative.
              role="radio"
              aria-checked={isSelected}
              data-testid={`theme-option-${opt.value}`}
              onClick={() => void setTheme(opt.value)}
              className={cn(
                "flex min-w-0 flex-col items-start gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-brand bg-surface-subtle"
                  : "border-border hover:border-border-subtle hover:bg-surface-hover",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 text-[13px] font-medium text-foreground">
                  {opt.label}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground">
                {opt.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
