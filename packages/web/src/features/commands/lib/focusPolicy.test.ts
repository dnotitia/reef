// @vitest-environment node

import { describe, expect, it } from "vitest";
import { shouldRestorePaletteFocus } from "./focusPolicy";

describe("palette focus policy", () => {
  it("restores connected origins only for same-surface actions", () => {
    expect(shouldRestorePaletteFocus("restore", true)).toBe(true);
    expect(shouldRestorePaletteFocus("restore", false)).toBe(false);
  });

  it("hands focus to navigation, locale, and dialog destinations", () => {
    expect(shouldRestorePaletteFocus("navigate", true)).toBe(false);
    expect(shouldRestorePaletteFocus("handoff", true)).toBe(false);
  });
});
