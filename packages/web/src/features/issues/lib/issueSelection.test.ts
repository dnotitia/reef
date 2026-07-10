// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  inclusiveSelectionRange,
  loadedSelectionState,
} from "./issueSelection";

describe("issueSelection", () => {
  it("builds an inclusive range in either direction", () => {
    const ids = ["A", "B", "C", "D"];
    expect(inclusiveSelectionRange(ids, "B", "D")).toEqual(["B", "C", "D"]);
    expect(inclusiveSelectionRange(ids, "D", "B")).toEqual(["B", "C", "D"]);
  });

  it("falls back to the target when the anchor is missing", () => {
    expect(inclusiveSelectionRange(["A", "B"], "missing", "B")).toEqual(["B"]);
  });

  it("reports loaded select-all tri-state", () => {
    expect(loadedSelectionState(new Set(), ["A", "B"])).toBe("unchecked");
    expect(loadedSelectionState(new Set(["A"]), ["A", "B"])).toBe("mixed");
    expect(loadedSelectionState(new Set(["A", "B", "other"]), ["A", "B"])).toBe(
      "checked",
    );
  });
});
