const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact relative timestamp for a comment header ("just now", "5m ago",
 * "3h ago", "2d ago"), falling back to an ISO calendar date past a week. Pure
 * and clock-injected (`nowMs`) so it is deterministic under test; the rendered
 * value is paired with an absolute `title` for precision.
 */
export function formatRelativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (sec < 45) return "just now";
  if (sec < HOUR) return `${Math.max(1, Math.round(sec / MINUTE))}m ago`;
  if (sec < DAY) return `${Math.round(sec / HOUR)}h ago`;
  if (sec < 7 * DAY) return `${Math.round(sec / DAY)}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}
