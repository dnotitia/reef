/**
 * UI-layer relative/absolute time formatting for issue rows and the issue
 * detail chrome. Locale-aware via `Intl.RelativeTimeFormat` /
 * `Intl.DateTimeFormat` (REEF-294): callers pass the active next-intl locale
 * (`useLocale()`) so the rendered phrase follows the app's selected language —
 * `2d ago` / `2일 전`, `yesterday` / `어제` — without a separate string catalog.
 * Do NOT reuse from packages/core.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Per-locale `Intl.RelativeTimeFormat` cache. `numeric: "auto"` yields the
 * locale's own special words (`yesterday` / `어제`, `today` / `오늘`); `narrow`
 * keeps the compact unit suffix (`2d ago`) that the issue rows rely on.
 */
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
      style: "narrow",
    });
    relativeFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * Per-locale absolute date+time formatter. UTC-pinned (REEF-294 / ADR-0001) and
 * 24-hour (`hour12: false`): a 12-hour clock's day-period word is locale data
 * that drifts between ICU versions (a Linux CI runner renders the Korean period
 * as `PM`, macOS as `오후`), which both breaks deterministic tests and risks an
 * SSR/client hydration mismatch on the rendered `title`. 24-hour has no period,
 * so the output is identical across every environment.
 */
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

function absoluteFormatter(locale: string): Intl.DateTimeFormat {
  let formatter = absoluteFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    });
    absoluteFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * Format an ISO date string as a human-readable relative time in the active
 * locale (`today` / `오늘`, `yesterday` / `어제`, `2d ago` / `그저께`,
 * `3mo ago` / `3개월 전`). Returns "—" for invalid dates. `nowMs` is injectable
 * for deterministic tests.
 */
export function formatRelativeTime(
  isoString: string,
  locale: string,
  nowMs: number = Date.now(),
): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  const rtf = relativeFormatter(locale);
  const diffDays = Math.floor((nowMs - date.getTime()) / MS_PER_DAY);
  // Future or same calendar day → the locale's "today" word.
  if (diffDays < 1) return rtf.format(0, "day");
  if (diffDays < 30) return rtf.format(-diffDays, "day");
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return rtf.format(-diffMonths, "month");
  return rtf.format(-Math.floor(diffMonths / 12), "year");
}

/**
 * Full localized date+time (UTC) for a `title` tooltip — the precise instant
 * paired with the compact relative label. Falls back to the raw ISO when
 * unparseable.
 */
export function formatAbsoluteTime(isoString: string, locale: string): string {
  const ms = Date.parse(isoString);
  return Number.isNaN(ms) ? isoString : absoluteFormatter(locale).format(ms);
}
