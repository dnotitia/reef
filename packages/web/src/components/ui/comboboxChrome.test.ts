// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CBX_SEARCH,
  CBX_TRIGGER_BUTTON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_FIELD,
} from "./comboboxChrome";

/**
 * Select/combobox triggers are controls and use keyboard-visible focus. Their
 * in-panel search input is a text-entry exception and uses focus on pointer or
 * keyboard entry so the insertion context stays visible.
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
      if (name === "CBX_SEARCH") return;
      expect(value).toContain("focus-visible:ring-2");
      expect(value).toContain("focus-visible:ring-brand-focus");
      // `focus:` (followed by `:`) would also trigger on mouse click — the bug.
      expect(value).not.toMatch(/(?:^|\s)focus:/);
    });
  }

  it("the in-panel search input shares the field trigger's brand border ring", () => {
    expect(CBX_SEARCH).toContain("focus:border-brand-focus");
    expect(CBX_SEARCH).toContain("focus:ring-2");
    expect(CBX_SEARCH).toContain("focus:ring-brand-focus");
    expect(CBX_SEARCH).not.toContain("focus-visible:ring");
  });
});
