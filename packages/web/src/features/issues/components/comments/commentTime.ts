const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Localized calendar date for timestamps older than a week — `Intl.DateTimeFormat`
 * (runtime locale) rather than a raw ISO slice, so the fallback reads naturally
 * and honors the user's locale. Paired with the absolute `title` for precision.
 */
const CALENDAR_DATE = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

/**
 * Compact relative timestamp for a comment header ("just now", "5m ago",
 * "3h ago", "2d ago"), falling back to a localized calendar date past a week.
 * Pure and clock-injected (`nowMs`) so it is deterministic under test; the
 * rendered value is paired with an absolute `title` for precision.
 */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (sec < 45) return "just now";
  if (sec < HOUR) return `${Math.max(1, Math.round(sec / MINUTE))}m ago`;
  if (sec < DAY) return `${Math.round(sec / HOUR)}h ago`;
  if (sec < 7 * DAY) return `${Math.round(sec / DAY)}d ago`;
  return CALENDAR_DATE.format(then);
}

/**
 * Full localized timestamp for a `title` tooltip — the precise time paired with
 * the compact relative label. Falls back to the raw ISO when unparseable.
 */
export function formatAbsoluteTime(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : new Date(ms).toLocaleString();
}
