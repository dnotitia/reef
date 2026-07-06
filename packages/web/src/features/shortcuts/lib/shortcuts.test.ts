// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  SHORTCUT_GROUPS,
  type ShortcutBinding,
  dispatchShortcut,
  formatKey,
  formatShortcut,
  getShortcutKeys,
  isEditableShortcutTarget,
  isInteractiveShortcutTarget,
  matchesShortcutKey,
} from "./shortcuts";

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

  it("renders arrow tokens as platform-neutral glyphs", () => {
    expect(formatKey("arrowUp", true)).toBe("↑");
    expect(formatKey("arrowDown", false)).toBe("↓");
  });
});

describe("formatShortcut", () => {
  it("joins formatted key tokens in display order", () => {
    expect(formatShortcut(["mod", "I"], true)).toBe("⌘+I");
    expect(formatShortcut(["mod", "I"], false)).toBe("Ctrl+I");
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
        "goIssues",
        "goMyWork",
        "goActivity",
        "goReports",
        "goBacklog",
        "newIssue",
        "focusNextIssue",
        "focusPreviousIssue",
        "openFocusedIssue",
        "editStatus",
        "editAssignee",
        "editPriority",
        "editLabels",
        "toggleAskAi",
      ]),
    );
  });

  it("uses a browser-safe chord for the new issue action", () => {
    const newIssue = SHORTCUT_GROUPS.flatMap((g) => g.shortcuts).find(
      (s) => s.labelKey === "newIssue",
    );
    expect(newIssue?.keys).toEqual(["mod", "I"]);
    expect(newIssue?.firefoxKeys).toEqual(["mod", "alt", "N"]);
  });

  it("keeps the Firefox fallback off the primary declaration by default", () => {
    const newIssue = SHORTCUT_GROUPS.flatMap((g) => g.shortcuts).find(
      (s) => s.labelKey === "newIssue",
    );
    expect(newIssue ? getShortcutKeys(newIssue) : []).toEqual(["mod", "I"]);
  });

  it("every shortcut declares at least one key", () => {
    for (const g of SHORTCUT_GROUPS) {
      for (const s of g.shortcuts) {
        expect(s.keys.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("shortcut dispatch", () => {
  function event(
    key: string,
    init: Partial<KeyboardEventInit> = {},
    target?: EventTarget,
  ): KeyboardEvent {
    const e = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    });
    if (target) {
      Object.defineProperty(e, "target", { value: target });
    }
    return e;
  }

  it("matches keys and modifier contracts exactly", () => {
    expect(
      matchesShortcutKey(event("k", { metaKey: true }), {
        key: "k",
        modKey: true,
      }),
    ).toBe(true);
    expect(
      matchesShortcutKey(event("k", { metaKey: true, shiftKey: true }), {
        key: "k",
        modKey: true,
      }),
    ).toBe(false);
  });

  it("detects editable targets including contenteditable descendants", () => {
    const wrapper = document.createElement("div");
    wrapper.contentEditable = "true";
    const child = document.createElement("span");
    wrapper.append(child);
    expect(isEditableShortcutTarget(child)).toBe(true);
    expect(isEditableShortcutTarget(document.createElement("input"))).toBe(
      true,
    );
  });

  it("detects interactive controls but not declared shortcut surfaces", () => {
    const button = document.createElement("button");
    const link = document.createElement("a");
    link.href = "/issues";
    const menuItem = document.createElement("div");
    menuItem.setAttribute("role", "menuitem");
    const shortcutSurface = document.createElement("div");
    shortcutSurface.setAttribute("role", "button");
    shortcutSurface.setAttribute("data-shortcut-surface", "issue-card");
    const nestedButton = document.createElement("button");
    shortcutSurface.append(nestedButton);

    expect(isInteractiveShortcutTarget(button)).toBe(true);
    expect(isInteractiveShortcutTarget(link)).toBe(true);
    expect(isInteractiveShortcutTarget(menuItem)).toBe(true);
    expect(isInteractiveShortcutTarget(shortcutSurface)).toBe(false);
    expect(isInteractiveShortcutTarget(nestedButton)).toBe(true);
  });

  it("dispatches scoped handlers only for the active scope", () => {
    const global = vi.fn();
    const list = vi.fn();
    const board = vi.fn();
    const registry: ShortcutBinding[] = [
      {
        labelKey: "openGlobalSearch",
        scope: "global",
        keys: [{ key: "x" }],
        handler: global,
      },
      {
        labelKey: "focusNextIssue",
        scope: "list",
        keys: [{ key: "j" }],
        handler: list,
      },
      {
        labelKey: "focusNextIssue",
        scope: "board",
        keys: [{ key: "j" }],
        handler: board,
      },
    ];

    expect(dispatchShortcut(event("j"), registry, "board").handled).toBe(true);
    expect(global).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(board).toHaveBeenCalledTimes(1);
  });

  it("blocks unmodified shortcuts in editable targets unless a binding opts in", () => {
    const input = document.createElement("input");
    const blocked = vi.fn();
    const allowed = vi.fn();
    const registry: ShortcutBinding[] = [
      {
        labelKey: "newIssue",
        scope: "global",
        keys: [{ key: "n" }],
        handler: blocked,
      },
      {
        labelKey: "openGlobalSearch",
        scope: "global",
        keys: [{ key: "k", modKey: true }],
        allowEditableTarget: true,
        allowInteractiveTarget: true,
        handler: allowed,
      },
    ];

    expect(
      dispatchShortcut(event("n", {}, input), registry, "global").handled,
    ).toBe(false);
    expect(
      dispatchShortcut(event("k", { metaKey: true }, input), registry, "global")
        .handled,
    ).toBe(true);
    expect(blocked).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(1);
  });

  it("blocks shortcuts in focused controls unless a binding opts in", () => {
    const button = document.createElement("button");
    const blocked = vi.fn();
    const allowed = vi.fn();
    const registry: ShortcutBinding[] = [
      {
        labelKey: "openFocusedIssue",
        scope: "list",
        keys: [{ key: "Enter" }],
        handler: blocked,
      },
      {
        labelKey: "openGlobalSearch",
        scope: "global",
        keys: [{ key: "k", modKey: true }],
        allowInteractiveTarget: true,
        handler: allowed,
      },
    ];

    expect(
      dispatchShortcut(event("Enter", {}, button), registry, "list").handled,
    ).toBe(false);
    expect(
      dispatchShortcut(event("k", { metaKey: true }, button), registry, "list")
        .handled,
    ).toBe(true);
    expect(blocked).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(1);
  });

  it("allows issue shortcut surfaces to receive list and board bindings", () => {
    const surface = document.createElement("div");
    surface.setAttribute("role", "button");
    surface.setAttribute("data-shortcut-surface", "issue-card");
    const handler = vi.fn();

    expect(
      dispatchShortcut(
        event("j", {}, surface),
        [
          {
            labelKey: "focusNextIssue",
            scope: "board",
            keys: [{ key: "j" }],
            handler,
          },
        ],
        "board",
      ).handled,
    ).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores IME composition events", () => {
    const handler = vi.fn();
    const e = event("j");
    Object.defineProperty(e, "isComposing", { value: true });
    expect(
      dispatchShortcut(
        e,
        [
          {
            labelKey: "focusNextIssue",
            scope: "list",
            keys: [{ key: "j" }],
            handler,
          },
        ],
        "list",
      ).handled,
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores key events already handled by nested controls", () => {
    const handler = vi.fn();
    const e = event("ArrowDown");
    e.preventDefault();

    expect(
      dispatchShortcut(
        e,
        [
          {
            labelKey: "focusNextIssue",
            scope: "board",
            keys: [{ key: "ArrowDown" }],
            handler,
          },
        ],
        "board",
      ).handled,
    ).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
