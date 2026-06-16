import { type IssueListItem, isResolvedStatus } from "@reef/core";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sticky issue-label column width (px). Shared by the grid template. */
export const LABEL_WIDTH = 280;
/** Width of a single day column (px). Shared by the grid template. */
export const DAY_WIDTH = 22;
/**
 * Where to anchor "today" inside the scrollable day viewport: 0 pins it to the
 * left edge, 1 to the right. 0.38 keeps recent past visible on the left while
 * favouring upcoming work on the right.
 */
const TODAY_ANCHOR_RATIO = 0.38;

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const PRIORITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
  key: string;
}

export interface TimelineRange {
  start: CalendarDay;
  end: CalendarDay;
  label: string;
}

export type TimelineItemKind = "range" | "start" | "deadline" | "invalid";

export interface TimelineItem {
  issue: IssueListItem;
  kind: TimelineItemKind;
  start: CalendarDay | null;
  due: CalendarDay | null;
  renderStart: CalendarDay;
  renderEnd: CalendarDay;
  startIndex: number;
  endIndex: number;
  spanDays: number;
  startsBeforeRange: boolean;
  endsAfterRange: boolean;
  isOverdue: boolean;
  title: string;
}

export interface TimelineMonthSpan {
  key: string;
  label: string;
  startIndex: number;
  endIndex: number;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function createCalendarDay(
  year: number,
  month: number,
  day: number,
): CalendarDay {
  return {
    year,
    month,
    day,
    key: `${year}-${pad(month)}-${pad(day)}`,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseCalendarDay(
  value: string | null | undefined,
): CalendarDay | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  return createCalendarDay(year, month, day);
}

export function calendarDayFromDate(date: Date): CalendarDay {
  return createCalendarDay(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
}

function calendarDayToUtcMs(day: CalendarDay): number {
  return Date.UTC(day.year, day.month - 1, day.day);
}

function calendarDayFromUtcMs(ms: number): CalendarDay {
  const date = new Date(ms);
  return createCalendarDay(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
}

export function compareCalendarDays(a: CalendarDay, b: CalendarDay): number {
  return calendarDayToUtcMs(a) - calendarDayToUtcMs(b);
}

export function diffCalendarDays(a: CalendarDay, b: CalendarDay): number {
  return Math.round((calendarDayToUtcMs(b) - calendarDayToUtcMs(a)) / DAY_MS);
}

function addCalendarDays(day: CalendarDay, offset: number): CalendarDay {
  return calendarDayFromUtcMs(calendarDayToUtcMs(day) + offset * DAY_MS);
}

function clampCalendarDay(day: CalendarDay, range: TimelineRange): CalendarDay {
  if (compareCalendarDays(day, range.start) < 0) return range.start;
  if (compareCalendarDays(day, range.end) > 0) return range.end;
  return day;
}

export function formatCalendarDay(day: CalendarDay | null): string {
  return day?.key ?? "—";
}

export function getQuarterRange(reference: Date): TimelineRange {
  const year = reference.getFullYear();
  const quarterStartMonth = Math.floor(reference.getMonth() / 3) * 3 + 1;
  const quarter = Math.floor((quarterStartMonth - 1) / 3) + 1;
  const quarterEndMonth = quarterStartMonth + 2;

  return {
    start: createCalendarDay(year, quarterStartMonth, 1),
    end: createCalendarDay(
      year,
      quarterEndMonth,
      daysInMonth(year, quarterEndMonth),
    ),
    label: `Q${quarter} ${year}`,
  };
}

export function shiftQuarter(reference: Date, offset: number): Date {
  return new Date(
    reference.getFullYear(),
    reference.getMonth() + offset * 3,
    1,
  );
}

/**
 * The `scrollLeft` that positions the today column at `anchorRatio` of the
 * scrollable day viewport (the area right of the sticky label column). The
 * label width cancels out, so this is independent of where the grid sits on
 * screen. Floored at 0; the upper bound is left to the browser's own scroll
 * clamping. `todayIndex` is today's offset in day columns from the range start.
 */
export function computeTargetScrollLeft(
  viewportWidth: number,
  todayIndex: number,
  {
    dayWidth = DAY_WIDTH,
    labelWidth = LABEL_WIDTH,
    anchorRatio = TODAY_ANCHOR_RATIO,
  }: { dayWidth?: number; labelWidth?: number; anchorRatio?: number } = {},
): number {
  const dayViewport = Math.max(0, viewportWidth - labelWidth);
  return Math.max(0, todayIndex * dayWidth - dayViewport * anchorRatio);
}

export function getDaysInRange(range: TimelineRange): CalendarDay[] {
  const totalDays = diffCalendarDays(range.start, range.end) + 1;
  return Array.from({ length: totalDays }, (_, index) =>
    addCalendarDays(range.start, index),
  );
}

export function getMonthSpans(range: TimelineRange): TimelineMonthSpan[] {
  const days = getDaysInRange(range);
  const spans: TimelineMonthSpan[] = [];

  for (let index = 0; index < days.length; index++) {
    const day = days[index];
    const last = spans.at(-1);
    if (last?.key === `${day.year}-${day.month}`) {
      last.endIndex = index;
      continue;
    }

    spans.push({
      key: `${day.year}-${day.month}`,
      label: `${MONTH_LABELS[day.month - 1]} ${day.year}`,
      startIndex: index,
      endIndex: index,
    });
  }

  return spans;
}

function itemSortDay(item: TimelineItem): CalendarDay {
  return item.start ?? item.due ?? item.renderStart;
}

export function getTimelineItem(
  issue: IssueListItem,
  range: TimelineRange,
  today: CalendarDay = calendarDayFromDate(new Date()),
): TimelineItem | null {
  const start = parseCalendarDay(issue.start_date);
  const due = parseCalendarDay(issue.due_date);

  if (!start && !due) return null;

  const hasInvertedRange =
    start != null && due != null && compareCalendarDays(start, due) > 0;
  const logicalStart =
    start && due
      ? compareCalendarDays(start, due) <= 0
        ? start
        : due
      : (start ?? due);
  const logicalEnd =
    start && due
      ? compareCalendarDays(start, due) <= 0
        ? due
        : start
      : (start ?? due);

  if (!logicalStart || !logicalEnd) return null;

  const renderStart = clampCalendarDay(logicalStart, range);
  const renderEnd = clampCalendarDay(logicalEnd, range);
  const startIndex = diffCalendarDays(range.start, renderStart);
  const endIndex = diffCalendarDays(range.start, renderEnd);
  const kind: TimelineItemKind = hasInvertedRange
    ? "invalid"
    : start && due
      ? "range"
      : due
        ? "deadline"
        : "start";

  return {
    issue,
    kind,
    start,
    due,
    renderStart,
    renderEnd,
    startIndex,
    endIndex,
    spanDays: endIndex - startIndex + 1,
    startsBeforeRange: compareCalendarDays(logicalStart, range.start) < 0,
    endsAfterRange: compareCalendarDays(logicalEnd, range.end) > 0,
    isOverdue:
      due != null &&
      compareCalendarDays(due, today) < 0 &&
      !isResolvedStatus(issue.status),
    title: `${issue.id} ${issue.title} · start ${formatCalendarDay(start)} · due ${formatCalendarDay(due)}`,
  };
}

export function sortTimelineItems(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    const startCompare = compareCalendarDays(itemSortDay(a), itemSortDay(b));
    if (startCompare !== 0) return startCompare;

    const dueA = a.due ?? a.start ?? a.renderEnd;
    const dueB = b.due ?? b.start ?? b.renderEnd;
    const dueCompare = compareCalendarDays(dueA, dueB);
    if (dueCompare !== 0) return dueCompare;

    const priorityCompare =
      (PRIORITY_RANK[b.issue.priority ?? ""] ?? 0) -
      (PRIORITY_RANK[a.issue.priority ?? ""] ?? 0);
    if (priorityCompare !== 0) return priorityCompare;

    const updatedCompare = b.issue.updated_at.localeCompare(a.issue.updated_at);
    if (updatedCompare !== 0) return updatedCompare;

    return a.issue.id.localeCompare(b.issue.id);
  });
}
