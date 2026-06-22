// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./commentTime";

const NOW = Date.parse("2026-06-18T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("renders sub-minute as 'just now'", () => {
    expect(formatRelativeTime("2026-06-18T11:59:40.000Z", NOW)).toBe(
      "just now",
    );
  });

  it("renders minutes, hours, and days", () => {
    expect(formatRelativeTime("2026-06-18T11:30:00.000Z", NOW)).toBe("30m ago");
    expect(formatRelativeTime("2026-06-18T09:00:00.000Z", NOW)).toBe("3h ago");
    expect(formatRelativeTime("2026-06-16T12:00:00.000Z", NOW)).toBe("2d ago");
  });

  it("falls back to a localized calendar date past a week (Intl, not raw ISO)", () => {
    const iso = "2026-06-01T12:00:00.000Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(Date.parse(iso));
    const out = formatRelativeTime(iso, NOW);
    expect(out).toBe(expected);
    // No longer the bare ISO slice.
    expect(out).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns empty string for an unparseable value", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});
