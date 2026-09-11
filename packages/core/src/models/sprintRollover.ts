import type { IssueMetadata, IssueListItem } from "../schemas/issues/metadata";
import type { Sprint, SprintRolloverCounts } from "../schemas/planning/catalog";

export const SPRINT_ROLLOVER_ISSUE_STATUSES = [
  "todo",
  "in_progress",
  "in_review",
] as const;

export type SprintRolloverIssueStatus =
  (typeof SPRINT_ROLLOVER_ISSUE_STATUSES)[number];

type SprintRolloverIssue = Pick<
  IssueMetadata | IssueListItem,
  "status" | "sprint_id" | "archived_at"
>;

/** Return true for an unarchived issue that can be carried forward. */
export function isSprintRolloverCandidate(
  issue: SprintRolloverIssue,
  sourceSprintId: string,
): issue is SprintRolloverIssue & { status: SprintRolloverIssueStatus } {
  return (
    issue.sprint_id === sourceSprintId &&
    issue.archived_at == null &&
    (SPRINT_ROLLOVER_ISSUE_STATUSES as readonly string[]).includes(issue.status)
  );
}

function calendarDateParts(
  value: string | null | undefined,
): { year: number; month: number; day: number } | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/u.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return { year, month, day };
}

function calendarDateNumber(
  value: string | null | undefined,
): number | undefined {
  const parts = calendarDateParts(value);
  if (!parts) return undefined;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

function formatCalendarDate(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/** Whether a planning date has a valid UTC calendar-day representation. */
export function isValidUtcCalendarDate(
  value: string | null | undefined,
): boolean {
  return calendarDateNumber(value) !== undefined;
}

/** Normalize a planning date to its UTC calendar-day portion when valid. */
export function toUtcCalendarDate(
  value: string | null | undefined,
): string | null {
  const number = calendarDateNumber(value);
  return number === undefined ? null : formatCalendarDate(number);
}

/** Add whole calendar days without depending on the host machine time zone. */
export function addUtcCalendarDays(value: string, days: number): string | null {
  const number = calendarDateNumber(value);
  if (number === undefined || !Number.isInteger(days)) return null;
  return formatCalendarDate(number + days * 24 * 60 * 60 * 1000);
}

/** Return the number of UTC calendar-day boundaries between two valid dates. */
export function utcCalendarDayDistance(
  from: string,
  to: string,
): number | null {
  const fromNumber = calendarDateNumber(from);
  const toNumber = calendarDateNumber(to);
  if (fromNumber === undefined || toNumber === undefined) return null;
  return Math.round((toNumber - fromNumber) / (24 * 60 * 60 * 1000));
}

function utcToday(now: Date | number | string = Date.now()): string {
  const date =
    now instanceof Date
      ? now
      : typeof now === "number"
        ? new Date(now)
        : new Date(now);
  return date.toISOString().slice(0, 10);
}

/** Suggest the next sprint name while preserving a source suffix. */
export function suggestSprintRolloverName(sourceName: string): string {
  const trimmed = sourceName.trim();
  if (trimmed.slice(0, 6).toLowerCase() !== "sprint") {
    return `${trimmed} Next`;
  }

  let cursor = 6;
  while (cursor < trimmed.length && trimmed[cursor]?.trim() === "") {
    cursor += 1;
  }
  const numberStart = cursor;
  while (
    cursor < trimmed.length &&
    trimmed.charCodeAt(cursor) >= 48 &&
    trimmed.charCodeAt(cursor) <= 57
  ) {
    cursor += 1;
  }
  if (numberStart === cursor) return `${trimmed} Next`;

  const prefix = trimmed.slice(0, numberStart);
  const number = trimmed.slice(numberStart, cursor);
  return `${prefix}${Number(number) + 1}${trimmed.slice(cursor)}`.trim();
}

export interface SprintRolloverDateProposal {
  sourceEndDate: string;
  targetStartDate: string;
  targetEndDate: string | null;
}

/**
 * Build the confirmation defaults from UTC calendar dates. The source end is
 * explicit in the request so a retry can reuse this exact proposal.
 */
export function suggestSprintRolloverDates(
  sprint: Pick<Sprint, "start_date" | "end_date">,
  now: Date | number | string = Date.now(),
): SprintRolloverDateProposal {
  const today = utcToday(now);
  const sourceStart = toUtcCalendarDate(sprint.start_date);
  const sourceEnd = toUtcCalendarDate(sprint.end_date) ?? today;
  const targetStart = addUtcCalendarDays(sourceEnd, 1) ?? today;
  const targetStartNumber = calendarDateNumber(targetStart);
  const todayNumber = calendarDateNumber(today);
  const minimumTargetStart =
    targetStartNumber !== undefined &&
    todayNumber !== undefined &&
    targetStartNumber >= todayNumber
      ? targetStart
      : today;
  const normalizedSourceEnd = toUtcCalendarDate(sprint.end_date);
  const sourceDuration =
    sourceStart && normalizedSourceEnd
      ? utcCalendarDayDistance(sourceStart, sourceEnd)
      : null;
  const targetEnd =
    sourceDuration !== null &&
    sourceDuration !== undefined &&
    sourceDuration >= 0
      ? addUtcCalendarDays(minimumTargetStart, sourceDuration)
      : null;

  return {
    sourceEndDate: sourceEnd,
    targetStartDate: minimumTargetStart,
    targetEndDate: targetEnd,
  };
}

/** Summarize every issue linked to a source sprint for preview/result copy. */
export function summarizeSprintRolloverIssues(
  issues: readonly SprintRolloverIssue[],
  sourceSprintId: string,
): SprintRolloverCounts {
  const counts: SprintRolloverCounts = {
    eligible: 0,
    done: 0,
    closed: 0,
    backlog: 0,
    archived: 0,
    moved: 0,
    skipped: 0,
    failed: 0,
    conflicts: 0,
  };

  for (const issue of issues) {
    if (issue.sprint_id !== sourceSprintId) continue;
    if (issue.archived_at != null) {
      counts.archived += 1;
      continue;
    }
    if (isSprintRolloverCandidate(issue, sourceSprintId)) {
      counts.eligible += 1;
      continue;
    }
    if (issue.status === "done") {
      counts.done += 1;
    } else if (issue.status === "closed") {
      counts.closed += 1;
    } else if (issue.status === "backlog") {
      counts.backlog += 1;
    }
  }
  return counts;
}

/** Client-side nudge predicate for an overdue active sprint. */
export function shouldShowSprintRolloverNudge(input: {
  sprint: Pick<Sprint, "id" | "status" | "end_date">;
  issues: readonly SprintRolloverIssue[];
  now?: Date | number | string;
}): boolean {
  const endDate = toUtcCalendarDate(input.sprint.end_date);
  if (input.sprint.status !== "active" || !endDate) return false;
  if (endDate >= utcToday(input.now ?? Date.now())) return false;
  return input.issues.some((issue) =>
    isSprintRolloverCandidate(issue, input.sprint.id),
  );
}
