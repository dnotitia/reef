import { describe, expect, it } from "vitest";
import { deepEqual } from "./deepEqual";

describe("deepEqual", () => {
  it("compares nested JSON-compatible values independent of object key order", () => {
    expect(
      deepEqual(
        { labels: ["release", "ready"], meta: { attempt: 1, active: true } },
        { meta: { active: true, attempt: 1 }, labels: ["release", "ready"] },
      ),
    ).toBe(true);
  });

  it("distinguishes array order, missing keys, and primitive types", () => {
    expect(deepEqual(["ready", "release"], ["release", "ready"])).toBe(false);
    expect(deepEqual({ value: undefined }, {})).toBe(false);
    expect(deepEqual({ value: 1 }, { value: "1" })).toBe(false);
  });
});
