import { BASE_LOCALE, type Locale, isLocale } from "./locales";

/**
 * Resolve the active locale from the request, following ADR-0001's detection
 * chain: **cookie → Accept-Language → base (en)**.
 *
 * Kept as a pure function (no `next/headers`) so the chain itself is unit
 * testable; `request.ts` reads the cookie + header and delegates here.
 *
 * 1. An explicit persisted choice (the `NEXT_LOCALE` cookie) always wins.
 * 2. Otherwise the browser's `Accept-Language` is matched against the supported
 *    locales by descending quality, comparing on the primary subtag so
 *    `ko-KR` matches `ko`.
 * 3. Otherwise the base locale.
 */
export function resolveLocale(
  cookieLocale: string | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookieLocale)) return cookieLocale;
  return matchAcceptLanguage(acceptLanguage) ?? BASE_LOCALE;
}

/**
 * Pick the highest-quality supported locale from an `Accept-Language` header,
 * or `null` when none match. Malformed entries are skipped rather than thrown.
 */
function matchAcceptLanguage(
  acceptLanguage: string | null | undefined,
): Locale | null {
  if (!acceptLanguage) return null;

  const ranked = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      return {
        primary: tag.trim().toLowerCase().split("-")[0],
        q: Number.isFinite(q) ? q : 0,
      };
    })
    .filter((entry) => entry.primary.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { primary } of ranked) {
    if (isLocale(primary)) return primary;
  }
  return null;
}
