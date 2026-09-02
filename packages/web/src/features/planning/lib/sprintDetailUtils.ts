import type { Sprint } from "@reef/core";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/;

export type SprintTimeState =
  | { kind: "remaining"; days: number }
  | { kind: "elapsed"; days: number }
  | null;

function startOfUtcDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = ISO_DATE_PREFIX.exec(value);
  if (!match) return null;
  const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Return the sprint's end-date posture relative to a supplied instant.
 * Calendar arithmetic is UTC-based so server and browser renders agree.
 */
export function sprintTimeState(
  sprint: Pick<Sprint, "end_date">,
  now: number,
): SprintTimeState {
  const end = startOfUtcDay(sprint.end_date);
  if (end === null || Number.isNaN(now)) return null;

  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const days = Math.round((end - today) / DAY_MS);
  return days >= 0
    ? { kind: "remaining", days }
    : { kind: "elapsed", days: Math.abs(days) };
}
