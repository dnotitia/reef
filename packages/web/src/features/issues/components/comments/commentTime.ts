const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Per-locale `Intl.RelativeTimeFormat` cache (REEF-294). `numeric: "auto"` gives
 * the locale's own words (`now` / `지금`, `yesterday` / `어제`) and `narrow`
 * keeps the compact unit suffix (`30m ago`) the comment header relies on, so the
 * relative label follows the app's active locale without a string catalog.
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

const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

function absoluteFormatter(locale: string): Intl.DateTimeFormat {
  let formatter = absoluteFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    });
    absoluteFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * Compact relative timestamp for a comment header (`now`, `5m ago`, `3h ago`,
 * `2d ago` / `지금`, `5분 전`, `3시간 전`, `그저께`), falling back to a localized
 * calendar date past a week. Locale-aware (REEF-294) and clock-injected
 * (`nowMs`) so it is deterministic under test; the rendered value is paired with
 * an absolute `title` for precision.
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
