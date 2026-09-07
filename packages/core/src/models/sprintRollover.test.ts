import { describe, expect, it } from "vitest";
import {
  addUtcCalendarDays,
  isSprintRolloverCandidate,
  shouldShowSprintRolloverNudge,
  suggestSprintRolloverDates,
  suggestSprintRolloverName,
  summarizeSprintRolloverIssues,
  utcCalendarDayDistance,
} from "./sprintRollover";

const source = {
  id: "source",
  status: "active" as const,
  start_date: "2026-09-04",
  end_date: "2026-09-11",
};

describe("sprint rollover model", () => {
  it("suggests the next numbered name and preserves its suffix", () => {
    expect(suggestSprintRolloverName("Sprint 14 - 0.15.0").trim()).toBe(
      "Sprint 15 - 0.15.0",
    );
    expect(suggestSprintRolloverName("Discovery")).toBe("Discovery Next");
  });

  it("uses UTC calendar days for rollover date defaults", () => {
    expect(addUtcCalendarDays("2026-09-11", 1)).toBe("2026-09-12");
    expect(utcCalendarDayDistance("2026-09-04", "2026-09-11")).toBe(7);
    expect(
      suggestSprintRolloverDates(source, "2026-09-07T23:30:00-07:00"),
    ).toEqual({
      sourceEndDate: "2026-09-11",
      targetStartDate: "2026-09-12",
      targetEndDate: "2026-09-19",
    });
  });

  it("counts only unarchived todo, in-progress, and in-review issues as eligible", () => {
    const issues = [
      { sprint_id: "source", status: "todo", archived_at: null },
      { sprint_id: "source", status: "in_progress", archived_at: null },
      { sprint_id: "source", status: "in_review", archived_at: null },
      { sprint_id: "source", status: "done", archived_at: null },
      { sprint_id: "source", status: "closed", archived_at: null },
      { sprint_id: "source", status: "backlog", archived_at: null },
      { sprint_id: "source", status: "todo", archived_at: "2026-09-01" },
      { sprint_id: "other", status: "todo", archived_at: null },
    ] as const;

    expect(summarizeSprintRolloverIssues(issues, "source")).toMatchObject({
      eligible: 3,
      done: 1,
      closed: 1,
      backlog: 1,
      archived: 1,
    });
    expect(isSprintRolloverCandidate(issues[0], "source")).toBe(true);
    expect(isSprintRolloverCandidate(issues[6], "source")).toBe(false);
  });

  it("shows the overdue nudge only for an active sprint with eligible work", () => {
    expect(
      shouldShowSprintRolloverNudge({
        sprint: source,
        issues: [{ sprint_id: "source", status: "todo", archived_at: null }],
        now: "2026-09-12T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      shouldShowSprintRolloverNudge({
        sprint: source,
        issues: [{ sprint_id: "source", status: "done", archived_at: null }],
        now: "2026-09-12T00:00:00Z",
      }),
    ).toBe(false);
    expect(
      shouldShowSprintRolloverNudge({
        sprint: { ...source, status: "planned" },
        issues: [{ sprint_id: "source", status: "todo", archived_at: null }],
        now: "2026-09-12T00:00:00Z",
      }),
    ).toBe(false);
  });
});
