/**
 * Locale registry — the single source of truth for which UI locales reef
 * supports and how they are transported.
 *
 * Pure data only (no React, no next-intl, no DOM), so it is importable from
 * every layer that needs it: the server request config (`request.ts`), the
 * client persistence store, the Settings switcher, and unit tests alike. Adding
 * a locale here (plus its catalog) is the one place the supported set grows.
 *
 * Scope (REEF-291 / ADR-0001): `en` and `ko` only. `en` is the base locale —
 * the detection fallback and the catalog every other locale falls back to for
 * missing keys.
 */

export const LOCALES = ["en", "ko"] as const;

export type Locale = (typeof LOCALES)[number];

/** The fallback locale: the detection floor and the missing-key base. */
export const BASE_LOCALE: Locale = "en";

/**
 * Cookie that mirrors the persisted locale so the server can resolve it on the
 * first request (before IndexedDB is readable). Non-httpOnly by design — it is
 * a per-viewer UI preference, not a secret, and the client writes it directly
 * via `document.cookie` (see `features/preferences/lib/locale.ts`). The name
 * matches next-intl's conventional `NEXT_LOCALE`.
 */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
