// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  APP_ACTION_CATALOG,
  getCheatsheetGroups,
  getPaletteActions,
  getShortcutActions,
} from "./appActionCatalog";

describe("app action catalog", () => {
  it("keeps ids unique and every action localized", () => {
    const ids = APP_ACTION_CATALOG.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      APP_ACTION_CATALOG.every((action) => action.labelKey.length > 0),
    ).toBe(true);
  });

  it("projects one catalog into palette, shortcuts, and cheatsheet", () => {
    expect(getPaletteActions().map((action) => action.id)).toContain(
      "issue.new",
    );
    expect(getShortcutActions().map((action) => action.id)).toContain(
      "issue.new",
    );
    expect(
      getCheatsheetGroups()
        .flatMap((group) => group.actions)
        .map((action) => action.id),
    ).toContain("issue.new");
  });

  it("keeps shortcut-only focus actions out of the palette", () => {
    expect(getPaletteActions().map((action) => action.id)).not.toContain(
      "issue.focusNext",
    );
    expect(getShortcutActions().map((action) => action.id)).toContain(
      "issue.focusNext",
    );
  });

  it("preserves the browser-safe new issue shortcut metadata", () => {
    const action = APP_ACTION_CATALOG.find(
      (candidate) => candidate.id === "issue.new",
    );
    expect(action?.shortcut).toMatchObject({
      keys: ["mod", "I"],
      firefoxKeys: ["mod", "alt", "N"],
    });
  });
});
