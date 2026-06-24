import { LOCALES, type Locale } from "@/i18n/locales";

export interface LocaleOption {
  value: Locale;
  /**
   * The language's endonym (its name in its own language). Language switchers
   * label each option in its own language so a speaker recognizes it regardless
   * of the active UI locale, so this is data, not a translated string.
   */
  label: string;
}

const ENDONYMS: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
};

/**
 * The locale choices shown in the Settings language switcher, derived from the
 * supported `LOCALES` so adding a locale in one place surfaces it here.
 */
export const LOCALE_OPTIONS: ReadonlyArray<LocaleOption> = LOCALES.map(
  (value) => ({ value, label: ENDONYMS[value] }),
);
