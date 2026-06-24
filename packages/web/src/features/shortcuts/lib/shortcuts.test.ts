// @vitest-environment node

import { describe, expect, it } from "vitest";
import { SHORTCUT_GROUPS, formatKey } from "./shortcuts";

describe("formatKey", () => {
  it("returns macOS symbols when mac=true", () => {
    expect(formatKey("mod", true)).toBe("⌘");
    expect(formatKey("shift", true)).toBe("⇧");
    expect(formatKey("alt", true)).toBe("⌥");
    expect(formatKey("ctrl", true)).toBe("⌃");
    expect(formatKey("enter", true)).toBe("⏎");
  });

  it("returns long-form names when mac=false", () => {
    expect(formatKey("mod", false)).toBe("Ctrl");
    expect(formatKey("shift", false)).toBe("Shift");
    expect(formatKey("alt", false)).toBe("Alt");
    expect(formatKey("ctrl", false)).toBe("Ctrl");
    expect(formatKey("enter", false)).toBe("Enter");
  });

  it("passes literal keys through unchanged", () => {
    expect(formatKey("K", true)).toBe("K");
    expect(formatKey("?", false)).toBe("?");
    expect(formatKey("Esc", true)).toBe("Esc");
  });
});

describe("SHORTCUT_GROUPS", () => {
  it("declares the shortcuts the shell binds", () => {
    const flat = SHORTCUT_GROUPS.flatMap((g) =>
      g.shortcuts.map((s) => s.labelKey),
    );
    expect(flat).toEqual(
      expect.arrayContaining([
        "openGlobalSearch",
        "showKeyboardShortcuts",
        "newIssue",
        "toggleAskAi",
      ]),
    );
  });

  it("every shortcut declares at least one key", () => {
    for (const g of SHORTCUT_GROUPS) {
      for (const s of g.shortcuts) {
        expect(s.keys.length).toBeGreaterThan(0);
      }
    }
  });
});
