import { ERROR_MESSAGES_EN } from "@reef/core/errors";
import { ISSUE_FIELD_MESSAGES_EN } from "@reef/core/fields";
import { PLANNING_FIELD_MESSAGES_EN } from "@reef/core/fields/planning";
import { BASE_LOCALE, type Locale } from "./locales";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

/**
 * The core-owned en base catalog for the ~60 field-registry labels (ADR-0001 /
 * REEF-292). `core` exports the message keys (the enum values) plus this en base
 * as pure data and never resolves locales; this is the merge seam REEF-291 left
 * open. Issue-field groups sit at `fields.*`; planning groups nest under
 * `fields.planning.*`. ko translations live in `ko.json` under the same shape
 * and fall back to these strings per key (AC3).
 */
const FIELD_MESSAGES_EN = {
  ...ISSUE_FIELD_MESSAGES_EN,
  planning: PLANNING_FIELD_MESSAGES_EN,
};

/**
 * The `errors` namespace: core-owned error-message codes (`ERROR_MESSAGES_EN`,
 * REEF-297) composed with the web-boundary strings `en.json` declares (session,
 * body-validation, and other Route Handler copy). core codes are locale-free
 * data web localizes at its error boundary; the two key sets are disjoint, so the
 * spread is a plain compose. ko translations live in `ko.json` under the same
 * `errors.*` shape and fall back to these strings per key (AC3).
 */
const ERROR_MESSAGES_BASE = { ...ERROR_MESSAGES_EN, ...en.errors };

/**
 * The full en base catalog: the web string files merged with the core field and
 * error catalogs. The structural single source of truth — every other locale is
 * a subset and any key it omits falls back to en at merge time (ADR-0001, AC3).
 */
const EN_BASE = {
  ...en,
  fields: FIELD_MESSAGES_EN,
  errors: ERROR_MESSAGES_BASE,
};

export type Messages = typeof EN_BASE;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * Per-locale catalogs. `en` is the full base; every other locale is a partial
 * over it. `satisfies` keeps each catalog structurally compatible with the base
 * without forcing a translated locale to be exhaustive — this is also the
 * compile-time check that every `fields.*` key ko declares is a real core key.
 */
const CATALOGS = { en: EN_BASE, ko } satisfies Record<
  Locale,
  DeepPartial<Messages>
>;

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
  if (locale === BASE_LOCALE) return EN_BASE;
  return deepMerge(EN_BASE, CATALOGS[locale]);
}
