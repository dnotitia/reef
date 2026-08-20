import { describe, expect, it } from "vitest";

import { AVATAR_BRAND, STATUS_COLORS, STATUS_TEXT_COLORS } from "./fieldKit";

describe("issue semantic field mappings", () => {
  it("keeps status glyph and label roles separate from planning tokens", () => {
    expect(STATUS_COLORS).toEqual({
      backlog: "text-status-backlog-glyph",
      todo: "text-status-open-glyph",
      in_progress: "text-status-in-progress-glyph",
      in_review: "text-status-in-review-glyph",
      done: "text-status-done-glyph",
      closed: "text-status-closed-glyph",
    });
    expect(STATUS_TEXT_COLORS).toEqual({
      backlog: "text-status-backlog-text",
      todo: "text-status-open-text",
      in_progress: "text-status-in-progress-text",
      in_review: "text-status-in-review-text",
      done: "text-status-done-text",
      closed: "text-status-closed-text",
    });
    expect(new Set(Object.values(STATUS_COLORS))).not.toEqual(
      new Set(Object.values(STATUS_TEXT_COLORS)),
    );
    expect(
      Object.values(STATUS_COLORS).every(
        (value) => !value.includes("planning"),
      ),
    ).toBe(true);
  });

  it("uses the brand fill/on-fill pair for the current-user avatar", () => {
    expect(AVATAR_BRAND).toBe("bg-brand-fill text-brand-on-fill");
  });
});
