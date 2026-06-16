// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CBX_SEARCH,
  CBX_TRIGGER_BUTTON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_FIELD,
} from "./comboboxChrome";

/**
 * REEF-226: every combobox/select control draws its focus ring on keyboard
 * focus only (`:focus-visible`), with the shared brand token. A bare `focus:`
 * selector also fires on mouse click, which flashed a ring on pointer use and
 * diverged from the input-family look. The in-panel search input was the last
 * holdout still on `focus:`; lock the whole frozen-chrome contract here.
 */
describe("comboboxChrome focus contract (REEF-226)", () => {
  const chrome = {
    CBX_SEARCH,
    CBX_TRIGGER_FIELD,
    CBX_TRIGGER_BUTTON,
    CBX_TRIGGER_CHIP,
  };

  for (const [name, value] of Object.entries(chrome)) {
    it(`${name} keys its ring off focus-visible, never bare focus`, () => {
      expect(value).toContain("focus-visible:ring-2");
      expect(value).toContain("focus-visible:ring-brand/30");
      // `focus:` (followed by `:`) would also trigger on mouse click — the bug.
      expect(value).not.toMatch(/(?:^|\s)focus:/);
    });
  }

  it("the in-panel search input shares the field trigger's brand border ring", () => {
    expect(CBX_SEARCH).toContain("focus-visible:border-brand");
    expect(CBX_SEARCH).toContain("focus-visible:ring-brand/30");
  });
});
