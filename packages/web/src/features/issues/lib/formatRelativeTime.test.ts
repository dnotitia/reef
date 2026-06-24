// @vitest-environment node

import { describe, expect, it } from "vitest";
import { formatAbsoluteTime, formatRelativeTime } from "./formatRelativeTime";

const NOW = Date.parse("2026-06-18T12:00:00.000Z");
const MS_PER_DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW - n * MS_PER_DAY).toISOString();

describe("formatRelativeTime", () => {
  it("renders day/month/year buckets in the active locale", () => {
    expect(formatRelativeTime(daysAgo(0), "en", NOW)).toBe("today");
    expect(formatRelativeTime(daysAgo(1), "en", NOW)).toBe("yesterday");
    expect(formatRelativeTime(daysAgo(5), "en", NOW)).toBe("5d ago");
    expect(formatRelativeTime(daysAgo(65), "en", NOW)).toBe("2mo ago");
    expect(formatRelativeTime(daysAgo(400), "en", NOW)).toBe("last yr.");
  });

  it("follows the active locale's relative-time conventions (ko)", () => {
    expect(formatRelativeTime(daysAgo(0), "ko", NOW)).toBe("오늘");
    expect(formatRelativeTime(daysAgo(1), "ko", NOW)).toBe("어제");
    expect(formatRelativeTime(daysAgo(5), "ko", NOW)).toBe("5일 전");
    expect(formatRelativeTime(daysAgo(65), "ko", NOW)).toBe("2개월 전");
    expect(formatRelativeTime(daysAgo(400), "ko", NOW)).toBe("작년");
  });

  it("returns an em dash for an unparseable value", () => {
    expect(formatRelativeTime("not-a-date", "en", NOW)).toBe("—");
  });
});

describe("formatAbsoluteTime", () => {
  it("renders a UTC date+time in the active locale", () => {
    const iso = "2026-06-11T14:05:00.000Z";
    expect(formatAbsoluteTime(iso, "en")).toBe("Jun 11, 2026, 2:05 PM");
    expect(formatAbsoluteTime(iso, "ko")).toBe("2026년 6월 11일 오후 2:05");
  });

  it("falls back to the raw input when unparseable", () => {
    expect(formatAbsoluteTime("not-a-date", "en")).toBe("not-a-date");
  });
});
