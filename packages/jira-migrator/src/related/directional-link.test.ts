import { describe, expect, it } from "vitest";
import { canonicalizeJiraRelation } from "./import.js";

describe("directional link canonicalization", () => {
  it("produces the same outward-to-inward edge from either endpoint view", () => {
    const mapping = {
      typeId: "1",
      kind: "directional" as const,
      outwardRelation: "depends_on" as const,
      inwardRelation: "blocks" as const,
    };
    const expected = {
      sourceReefId: "REEF-1",
      targetReefId: "REEF-2",
      relation: "depends_on",
      inverseRelation: "blocks",
    };
    expect(
      canonicalizeJiraRelation(mapping, "outward", "REEF-1", "REEF-2"),
    ).toEqual(expected);
    expect(
      canonicalizeJiraRelation(mapping, "inward", "REEF-2", "REEF-1"),
    ).toEqual(expected);
  });
});
