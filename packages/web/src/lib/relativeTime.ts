const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Shared compact relative/absolute time formatting (REEF-294). Locale-aware via
 * `Intl.RelativeTimeFormat` / `Intl.DateTimeFormat`: callers pass the active
 * next-intl locale (`useLocale()`) so the rendered phrase follows the app's
 * selected language without a separate string catalog.
 *
 * Minute-resolution: `now` / `5m ago` / `3h ago` / `2d ago` (and their locale
 * equivalents `지금` / `5분 전` / `3시간 전` / `그저께`), falling back to a
 * localized calendar date past a week. This is the compact granularity the
 * comment header, the issue activity timeline, and the GitHub-scan activity
 * feed all share — it is intentionally distinct from the day-resolution
 * `features/issues/lib/formatRelativeTime.ts` used by issue list/detail rows,
 * which collapses anything under a day to the locale's "today".
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
 * Per-locale formatter for the past-a-week calendar fallback and the absolute
 * tooltip. UTC-pinned (REEF-294 / ADR-0001) so the rendered day is identical
 * across server and client and the per-viewer axis stays the locale alone.
 */
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();

function calendarFormatter(locale: string): Intl.DateTimeFormat {
  let formatter = calendarFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    calendarFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * Absolute date+time for the tooltip. UTC-pinned and 24-hour (`hour12: false`):
 * a 12-hour day-period word ("오후" / "PM") is ICU-version-dependent locale data,
 * so it drifts between a Linux CI runner and a browser/macOS. 24-hour drops the
 * period, keeping the output deterministic and SSR/client hydration-safe.
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
 * Compact relative timestamp (`now`, `5m ago`, `3h ago`, `2d ago` / `지금`,
 * `5분 전`, `3시간 전`, `그저께`), falling back to a localized calendar date past
 * a week. Locale-aware (REEF-294) and clock-injected (`nowMs`) so it is
 * deterministic under test; the rendered value is paired with an absolute
 * `title` for precision. Returns "" for an unparseable value.
 */
export function formatRelativeTime(
  iso: string,
  nowMs: number,
  locale: string,
): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.round((nowMs - then) / 1000));
  const rtf = relativeFormatter(locale);
  if (sec < 45) return rtf.format(0, "second");
  if (sec < HOUR)
    return rtf.format(-Math.max(1, Math.round(sec / MINUTE)), "minute");
  if (sec < DAY) return rtf.format(-Math.round(sec / HOUR), "hour");
  if (sec < 7 * DAY) return rtf.format(-Math.round(sec / DAY), "day");
  return calendarFormatter(locale).format(then);
}

/**
 * Full localized date+time (UTC) for a `title` tooltip — the precise instant
 * paired with the compact relative label. Falls back to the raw ISO when
 * unparseable.
 */
export function formatAbsoluteTime(iso: string, locale: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : absoluteFormatter(locale).format(ms);
}
