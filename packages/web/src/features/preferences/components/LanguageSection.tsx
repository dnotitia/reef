"use client";

import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useLocalePreference } from "../hooks/useLocalePreference";
import { LOCALE_OPTIONS } from "../lib/localeOptions";

/**
 * Settings → Preferences language switcher (REEF-291). Mirrors the Appearance
 * tiles' structure/vocabulary so the two personal preferences read as one group.
 * Its own heading/description go through next-intl (`useTranslations`), so they
 * are the first strings to switch when the user picks a locale — the live proof
 * that the runtime works.
 */
export function LanguageSection() {
  const t = useTranslations("settings.preferences.language");
  const { locale, setLocale } = useLocalePreference();

  return (
    <section
      data-testid="language-section"
      className="flex flex-col gap-3"
      aria-labelledby="language-heading"
    >
      <header className="flex flex-col gap-1">
        <h3
          id="language-heading"
          className="font-display text-[13px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          {t("heading")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </header>

      <div
        role="radiogroup"
        aria-labelledby="language-heading"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-2"
      >
        {LOCALE_OPTIONS.map((opt) => {
          const isSelected = locale === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: matches the Appearance tiles — a styled tile, not a bare <input type="radio">; role="radio" inside an explicit radiogroup is the documented WAI-ARIA alternative.
              role="radio"
              aria-checked={isSelected}
              data-testid={`locale-option-${opt.value}`}
              onClick={() => void setLocale(opt.value)}
              className={cn(
                "flex min-w-0 items-center rounded-md border px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-brand bg-surface-subtle"
                  : "border-border hover:border-border-subtle hover:bg-surface-hover",
              )}
            >
              <span className="min-w-0 text-[13px] font-medium text-foreground">
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
