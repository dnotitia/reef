// @vitest-environment node

import { describe, expect, it } from "vitest";
import { scoreCommandFilter } from "./commandFilter";

describe("command filter", () => {
  it("scores aliases independently instead of matching across unrelated tokens", () => {
    expect(
      scoreCommandFilter("view.board", "dark", ["Board", "board", "kanban"]),
    ).toBe(0);
    expect(
      scoreCommandFilter("theme.dark", "dark", ["Dark", "다크", "어둡게"]),
    ).toBeGreaterThan(0);
  });
});
