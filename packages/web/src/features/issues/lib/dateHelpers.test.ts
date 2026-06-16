// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildMonthGrid,
  formatMonthYear,
  formatTimestampMonthDay,
  isValidIsoDate,
  localTodayIso,
  parseIsoDate,
  shiftDays,
  shiftMonths,
  ymdToIso,
} from "./dateHelpers";

describe("parseIsoDate", () => {
  it("parses a valid date into a 0-based month triple", () => {
    expect(parseIsoDate("2026-06-09")).toEqual({
      year: 2026,
      month: 5,
      day: 9,
    });
  });

  it("rejects malformed shapes", () => {
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate("2026-6-9")).toBeNull();
    expect(parseIsoDate("2026/06/09")).toBeNull();
    expect(parseIsoDate("2026-06-09T00:00:00Z")).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
  });

  it("isValidIsoDate mirrors parseIsoDate", () => {
    expect(isValidIsoDate("2026-06-09")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
  });
});

describe("ymdToIso", () => {
  it("formats a 0-based month triple, zero-padding", () => {
    expect(ymdToIso({ year: 2026, month: 0, day: 1 })).toBe("2026-01-01");
    expect(ymdToIso({ year: 2026, month: 11, day: 31 })).toBe("2026-12-31");
  });
});

describe("addMonths", () => {
  it("rolls the year forward and back", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe("shiftDays / shiftMonths", () => {
  it("crosses a month boundary by day", () => {
    expect(shiftDays({ year: 2026, month: 0, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 1,
      day: 1,
    });
  });

  it("steps whole months", () => {
    expect(shiftMonths({ year: 2026, month: 5, day: 15 }, 1)).toEqual({
      year: 2026,
      month: 6,
      day: 15,
    });
  });

  it("clamps a month-end day to the target month instead of overflowing", () => {
    // Mar 31 → Feb: clamp to Feb 28 (not "Feb 31" → Mar 3).
    expect(shiftMonths({ year: 2026, month: 2, day: 31 }, -1)).toEqual({
      year: 2026,
      month: 1,
      day: 28,
    });
    // May 31 → Apr: clamp to Apr 30.
    expect(shiftMonths({ year: 2026, month: 4, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 5,
      day: 30,
    });
  });
});

describe("formatMonthYear", () => {
  it("renders an English month name and year", () => {
    expect(formatMonthYear(2026, 5)).toBe("June 2026");
  });
});

describe("buildMonthGrid", () => {
  it("returns a fixed 6-row Monday-first grid", () => {
    // July 2026: July 1 is a Wednesday, so two leading June days (Mon/Tue).
    const grid = buildMonthGrid(2026, 6);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toEqual({
      iso: "2026-06-29",
      day: 29,
      inCurrentMonth: false,
    });
    expect(grid[2]).toEqual({
      iso: "2026-07-01",
      day: 1,
      inCurrentMonth: true,
    });
    expect(grid.filter((c) => c.inCurrentMonth)).toHaveLength(31);
  });
});

describe("localTodayIso", () => {
  it("produces a YYYY-MM-DD shape", () => {
    expect(localTodayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatTimestampMonthDay", () => {
  it("renders a fixed en-US month/day regardless of the system locale", () => {
    // consistently English worded month, does not the locale-driven `6월 11일`.
    expect(formatTimestampMonthDay("2026-06-11T00:00:00.000Z")).toBe("Jun 11");
  });

  it("pins the calendar day to UTC, not the viewer's offset", () => {
    // Late-UTC instant should still read as Jun 11, not roll to the local day.
    expect(formatTimestampMonthDay("2026-06-11T23:30:00.000Z")).toBe("Jun 11");
  });

  it("returns null for nullish or unparseable input so the label is omitted", () => {
    expect(formatTimestampMonthDay(null)).toBeNull();
    expect(formatTimestampMonthDay("not-a-date")).toBeNull();
  });
});
