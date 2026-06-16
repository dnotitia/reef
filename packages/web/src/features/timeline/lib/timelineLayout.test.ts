// @vitest-environment node

import type { IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  computeTargetScrollLeft,
  createCalendarDay,
  getQuarterRange,
  getTimelineItem,
  parseCalendarDay,
} from "./timelineLayout";

const baseIssue = {
  id: "REEF-001",
  title: "Timeline issue",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
} satisfies IssueMetadata;

describe("timelineLayout", () => {
  it("calculates the current quarter range", () => {
    const range = getQuarterRange(new Date(2026, 4, 22));

    expect(range.label).toBe("Q2 2026");
    expect(range.start.key).toBe("2026-04-01");
    expect(range.end.key).toBe("2026-06-30");
  });

  it("parses date-only values from ISO strings without timezone shifting", () => {
    expect(parseCalendarDay("2026-05-22")?.key).toBe("2026-05-22");
    expect(parseCalendarDay("2026-05-22T00:00:00.000Z")?.key).toBe(
      "2026-05-22",
    );
  });

  it("lays out a start-to-due range", () => {
    const range = getQuarterRange(new Date(2026, 4, 22));
    const item = getTimelineItem(
      {
        ...baseIssue,
        start_date: "2026-05-10",
        due_date: "2026-05-12",
      },
      range,
      createCalendarDay(2026, 5, 22),
    );

    expect(item?.kind).toBe("range");
    expect(item?.startIndex).toBe(39);
    expect(item?.endIndex).toBe(41);
    expect(item?.spanDays).toBe(3);
  });

  it("lays out due-only and start-only markers as one-day items", () => {
    const range = getQuarterRange(new Date(2026, 4, 22));

    const dueOnly = getTimelineItem(
      { ...baseIssue, due_date: "2026-06-01" },
      range,
      createCalendarDay(2026, 5, 22),
    );
    const startOnly = getTimelineItem(
      { ...baseIssue, start_date: "2026-04-03" },
      range,
      createCalendarDay(2026, 5, 22),
    );

    expect(dueOnly?.kind).toBe("deadline");
    expect(dueOnly?.spanDays).toBe(1);
    expect(startOnly?.kind).toBe("start");
    expect(startOnly?.spanDays).toBe(1);
  });

  it("clamps ranges that extend outside the visible quarter", () => {
    const range = getQuarterRange(new Date(2026, 4, 22));
    const item = getTimelineItem(
      {
        ...baseIssue,
        start_date: "2026-03-15",
        due_date: "2026-04-05",
      },
      range,
      createCalendarDay(2026, 5, 22),
    );

    expect(item?.renderStart.key).toBe("2026-04-01");
    expect(item?.renderEnd.key).toBe("2026-04-05");
    expect(item?.startsBeforeRange).toBe(true);
    expect(item?.endsAfterRange).toBe(false);
  });

  it("marks inverted start/due ranges as invalid", () => {
    const range = getQuarterRange(new Date(2026, 4, 22));
    const item = getTimelineItem(
      {
        ...baseIssue,
        start_date: "2026-05-25",
        due_date: "2026-05-20",
      },
      range,
      createCalendarDay(2026, 5, 22),
    );

    expect(item?.kind).toBe("invalid");
    expect(item?.renderStart.key).toBe("2026-05-20");
    expect(item?.renderEnd.key).toBe("2026-05-25");
  });
});

describe("computeTargetScrollLeft", () => {
  it("anchors today at ~38% of the day viewport", () => {
    // viewport 1000, label 280 -> day viewport 720; 720 * 0.38 = 273.6.
    // todayIndex 40 -> 40 * 22 = 880; 880 - 273.6 = 606.4.
    expect(computeTargetScrollLeft(1000, 40)).toBeCloseTo(606.4, 1);
  });

  it("floors at 0 near the quarter start", () => {
    // todayIndex 2 -> 44px, less than the 273.6px anchor offset.
    expect(computeTargetScrollLeft(1000, 2)).toBe(0);
  });

  it("honors a custom anchor ratio", () => {
    // anchorRatio 0 pins today to the left edge of the day viewport.
    expect(computeTargetScrollLeft(1000, 40, { anchorRatio: 0 })).toBe(880);
  });

  it("honors custom column and label widths", () => {
    // 50 * 10 - (2000 - 200) * 0.5 = 500 - 900 -> floored to 0.
    expect(
      computeTargetScrollLeft(2000, 50, {
        dayWidth: 10,
        labelWidth: 200,
        anchorRatio: 0.5,
      }),
    ).toBe(0);
  });
});
