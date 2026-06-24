// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatAbsoluteTime, formatRelativeTime } from "./relativeTime";

const NOW = Date.parse("2026-06-18T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("renders sub-minute as the locale's 'now'", () => {
    expect(formatRelativeTime("2026-06-18T11:59:40.000Z", NOW, "en")).toBe(
      "now",
    );
    expect(formatRelativeTime("2026-06-18T11:59:40.000Z", NOW, "ko")).toBe(
      "지금",
    );
  });

  it("renders minutes, hours, and days in the active locale", () => {
    expect(formatRelativeTime("2026-06-18T11:30:00.000Z", NOW, "en")).toBe(
      "30m ago",
    );
    expect(formatRelativeTime("2026-06-18T09:00:00.000Z", NOW, "en")).toBe(
      "3h ago",
    );
    expect(formatRelativeTime("2026-06-16T12:00:00.000Z", NOW, "en")).toBe(
      "2d ago",
    );
    expect(formatRelativeTime("2026-06-18T11:30:00.000Z", NOW, "ko")).toBe(
      "30분 전",
    );
    expect(formatRelativeTime("2026-06-16T12:00:00.000Z", NOW, "ko")).toBe(
      "그저께",
    );
  });

  it("falls back to a localized, UTC-pinned calendar date past a week", () => {
    const iso = "2026-06-01T12:00:00.000Z";
    expect(formatRelativeTime(iso, NOW, "en")).toBe("Jun 1, 2026");
    expect(formatRelativeTime(iso, NOW, "ko")).toBe("2026년 6월 1일");
    // No longer the bare ISO slice.
    expect(formatRelativeTime(iso, NOW, "en")).not.toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("returns empty string for an unparseable value", () => {
    expect(formatRelativeTime("not-a-date", NOW, "en")).toBe("");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders a UTC, 24-hour date+time in the active locale", () => {
    const iso = "2026-06-11T14:05:00.000Z";
    expect(formatAbsoluteTime(iso, "en")).toBe("Jun 11, 2026, 14:05");
    expect(formatAbsoluteTime(iso, "ko")).toBe("2026년 6월 11일 14:05");
  });

  it("falls back to the raw input when unparseable", () => {
    expect(formatAbsoluteTime("not-a-date", "en")).toBe("not-a-date");
  });
});
