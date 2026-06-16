/**
 * Pure date helpers for the themed date picker (REEF-108).
 *
 * Everything here is framework-agnostic and side-effect free except the
 * `local*` readers that intentionally consult the current clock. All dates
 * cross the boundary as `YYYY-MM-DD` strings; internally we work with a
 * `{ year, month, day }` triple where `month` is 0-based to match JS `Date`.
 *
 * The "today" value is consistently derived from the browser-local calendar day
 * (does not `toISOString()`), so a user a few hours behind UTC does not get
 * tomorrow's date around midnight.
 */

/** Hoisted once — recompiling per call would be wasteful (js-hoist-regexp). */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Monday-first weekday headers, matching the work-week calendar convention. */
export const WEEKDAY_LABELS = [
  "Mo",
  "Tu",
  "We",
  "Th",
  "Fr",
  "Sa",
  "Su",
] as const;

/** A calendar day with `month` 0-based (JS `Date` semantics). */
export interface Ymd {
  year: number;
  month: number;
  day: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format a `{ year, month, day }` triple (month 0-based) as `YYYY-MM-DD`. */
export function ymdToIso({ year, month, day }: Ymd): string {
  return `${year.toString().padStart(4, "0")}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * Parse a strict `YYYY-MM-DD` string into a `{ year, month, day }` triple, or
 * `null` when the shape is wrong or the date is impossible (e.g. 2026-02-30).
 */
export function parseIsoDate(value: string): Ymd | null {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  // Round-trip through Date so overflow dates (Feb 30, month 13) are rejected.
  const probe = new Date(year, month, day);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

/** The browser-local calendar day as `YYYY-MM-DD`. */
export function localTodayIso(): string {
  const now = new Date();
  return ymdToIso({
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
  });
}

/** Step a year/month pair by whole months, normalizing the year rollover. */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const probe = new Date(year, month + delta, 1);
  return { year: probe.getFullYear(), month: probe.getMonth() };
}

/** Step a day by `delta` days, crossing month/year boundaries correctly. */
export function shiftDays(ymd: Ymd, delta: number): Ymd {
  const probe = new Date(ymd.year, ymd.month, ymd.day + delta);
  return {
    year: probe.getFullYear(),
    month: probe.getMonth(),
    day: probe.getDate(),
  };
}

/**
 * Step a day by `delta` whole months, clamping the day to the target month's
 * last day. Plain `Date` overflow would roll a month-end day into the next
 * month (Mar 31 → "Feb 31" → Mar 3), so PageUp/PageDown is clamped instead.
 */
export function shiftMonths(ymd: Ymd, delta: number): Ymd {
  // Normalize the target year/month off day 1 so no overflow can occur yet.
  const target = new Date(ymd.year, ymd.month + delta, 1);
  const year = target.getFullYear();
  const month = target.getMonth();
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { year, month, day: Math.min(ymd.day, lastDay) };
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month]} ${year}`;
}

/**
 * Hoisted formatter — constructing `Intl.DateTimeFormat` per call is wasteful.
 * A fixed `en-US` locale plus a UTC time zone keep the rendered day identical
 * across server and client (hydration-safe) and stop the viewer's offset from
 * shifting the calendar day.
 */
const DISPLAY_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Format a `YYYY-MM-DD` string as a short, readable date (`Jun 1, 2026`) via
 * `Intl.DateTimeFormat` rather than surfacing the raw ISO. A worded month is
 * both clearer and shorter than `2026-06-01`, so it no longer clips in the
 * narrow planning columns. Returns the input unchanged when it is not a valid
 * date, so empty/partial values pass through safely.
 */
export function formatDisplayDate(iso: string): string {
  const ymd = parseIsoDate(iso);
  if (!ymd) return iso;
  return DISPLAY_DATE_FORMAT.format(Date.UTC(ymd.year, ymd.month, ymd.day));
}

/**
 * Month/day variant of the display formatter (e.g. `Jun 11`) — the same fixed
 * `en-US` + UTC contract as `formatDisplayDate`, for surfaces that show a day
 * without the year. Hoisted; per-call construction would be wasteful.
 */
const SHORT_MONTH_DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * Format an ISO-8601 timestamp as a short month/day (`Jun 11`) in the app's
 * fixed `en-US` + UTC convention, independent of the viewer's system locale.
 * Unlike `formatDisplayDate`, this takes a full timestamp (not a `YYYY-MM-DD`
 * day) because the input is a wall-clock instant such as a last-synced marker.
 * Returns `null` for nullish or unparseable input so callers can omit the label.
 */
export function formatTimestampMonthDay(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return SHORT_MONTH_DAY_FORMAT.format(ms);
}

export interface CalendarDay {
  /** `YYYY-MM-DD` for this cell. */
  iso: string;
  /** Day-of-month number to render. */
  day: number;
  /** False for the leading/trailing days that belong to an adjacent month. */
  inCurrentMonth: boolean;
}

/**
 * Build a fixed 6-row (42-cell) Monday-first month grid. A fixed height keeps
 * the popover from jumping as the user pages between months.
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[] {
  const first = new Date(year, month, 1);
  // getDay(): 0=Sun..6=Sat → Monday-first leading-blank count.
  const offset = (first.getDay() + 6) % 7;
  const cells: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - offset + i);
    cells.push({
      iso: ymdToIso({
        year: d.getFullYear(),
        month: d.getMonth(),
        day: d.getDate(),
      }),
      day: d.getDate(),
      inCurrentMonth: d.getMonth() === month && d.getFullYear() === year,
    });
  }
  return cells;
}
