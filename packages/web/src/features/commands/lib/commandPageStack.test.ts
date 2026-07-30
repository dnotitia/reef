// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  initialCommandPageState,
  reduceCommandPageState,
} from "./commandPageStack";

describe("command page stack", () => {
  it("pushes a nested page and clears its query", () => {
    expect(
      reduceCommandPageState(
        { ...initialCommandPageState, query: "view" },
        { type: "push", page: "view" },
      ),
    ).toEqual({ pages: ["root", "view"], query: "" });
  });

  it("pops an empty nested query on Backspace and any nested page on Escape", () => {
    const nested = { pages: ["root", "theme"] as const, query: "" };
    expect(reduceCommandPageState(nested, { type: "backspace" })).toEqual({
      pages: ["root"],
      query: "",
    });
    expect(reduceCommandPageState(nested, { type: "escape" })).toEqual({
      pages: ["root"],
      query: "",
    });
    expect(
      reduceCommandPageState(
        { pages: ["root", "theme"], query: "dark" },
        { type: "escape" },
      ),
    ).toEqual({ pages: ["root"], query: "" });
  });

  it("closes when Escape is pressed at the root", () => {
    expect(
      reduceCommandPageState(initialCommandPageState, { type: "escape" }),
    ).toEqual({ ...initialCommandPageState, close: true });
  });
});
