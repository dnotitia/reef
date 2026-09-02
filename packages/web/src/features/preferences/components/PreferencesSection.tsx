"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useTheme } from "../hooks/useTheme";
import { THEME_OPTIONS } from "../lib/themeOptions";

export function PreferencesSection() {
  const t = useTranslations("settings.preferences.appearance");
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
          className="type-section-label text-muted-foreground"
        >
          {t("heading")}
        </h3>
        <p className="type-caption text-muted-foreground">{t("description")}</p>
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
              role="radio"
              aria-checked={isSelected}
              data-testid={`theme-option-${opt.value}`}
              onClick={() => void setTheme(opt.value)}
              className={cn(
                "flex min-w-0 flex-col items-start gap-1.5 rounded-md border px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                isSelected
                  ? "border-brand-focus bg-surface-subtle"
                  : "border-border hover:border-border-subtle hover:bg-surface-hover",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Icon
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span className="type-control min-w-0 font-medium text-foreground">
                  {opt.label}
                </span>
              </span>
              <span className="type-caption text-muted-foreground">
                {opt.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
