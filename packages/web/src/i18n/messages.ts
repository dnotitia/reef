import { BASE_LOCALE, type Locale } from "./locales";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

/**
 * The message catalog shape, inferred from the base (en) catalog so the base
 * is the single structural source of truth. Other locales may be a subset —
 * any key they omit falls back to en at merge time (ADR-0001, AC3).
 *
 * For S1 the catalogs are a scaffold (just the Settings language section). S2
 * migrates the ~190 web string files and S2 also merges a core-owned en catalog
 * for the ~60 field-registry labels; the merge seam below is where that core
 * catalog will compose in.
 */
export type Messages = typeof en;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Per-locale catalogs. `en` is the full base; every other locale is a partial
 * over it. `satisfies` keeps each catalog structurally compatible with the base
 * without forcing a translated locale to be exhaustive.
 */
const CATALOGS = { en, ko } satisfies Record<Locale, DeepPartial<Messages>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively overlay `override` onto `base`. A key present in `override` wins;
 * a key present only in `base` is retained — this is the "missing key falls back
 * to base (en)" guarantee, applied once at load time so the next-intl provider
 * never sees a hole.
 */
export function deepMerge<T>(base: T, override: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override as T | undefined) ?? base;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const baseValue = result[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? deepMerge(baseValue, value as DeepPartial<typeof baseValue>)
        : value;
  }
  return result as T;
}

/**
 * Resolve the full message set for a locale. The base locale returns its
 * catalog directly; any other locale is deep-merged over the en base so missing
 * keys fall back to English.
 */
export function loadMessages(locale: Locale): Messages {
  if (locale === BASE_LOCALE) return en;
  return deepMerge(en, CATALOGS[locale]);
}
