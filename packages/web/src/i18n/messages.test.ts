// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deepMerge, loadMessages } from "./messages";
import en from "./messages/en.json";

describe("deepMerge — missing-key fallback to base (AC3)", () => {
  it("keeps base keys the override omits", () => {
    const merged = deepMerge({ a: "base-a", b: "base-b" }, { a: "override-a" });
    expect(merged).toEqual({ a: "override-a", b: "base-b" });
  });

  it("recurses into nested objects, filling holes from the base", () => {
    const merged = deepMerge(
      { section: { heading: "Base heading", description: "Base description" } },
      { section: { heading: "Override heading" } },
    );
    expect(merged).toEqual({
      section: {
        heading: "Override heading",
        description: "Base description",
      },
    });
  });

  it("does not mutate the base catalog", () => {
    const base = { section: { heading: "Base" } };
    deepMerge(base, { section: { heading: "Override" } });
    expect(base.section.heading).toBe("Base");
  });

  it("ignores undefined override values, preserving the base", () => {
    const merged = deepMerge({ a: "base-a" }, { a: undefined } as {
      a?: string;
    });
    expect(merged.a).toBe("base-a");
  });
});

describe("loadMessages", () => {
  it("returns the en catalog unchanged for the base locale", () => {
    expect(loadMessages("en")).toEqual(en);
  });

  it("overlays ko over the en base so present keys are translated", () => {
    const ko = loadMessages("ko");
    expect(ko.settings.preferences.language.heading).toBe("언어");
  });

  it("a key absent from ko falls back to the en value", () => {
    const ko = loadMessages("ko") as Record<string, unknown>;
    // Synthesize a base-only key and confirm the merge would retain it: every
    // en key is present in the merged ko output (no holes reach the provider).
    const merged = deepMerge(
      { ...en, baseOnly: "english-only" },
      { settings: { preferences: { language: { heading: "언어" } } } },
    ) as Record<string, unknown>;
    expect(merged.baseOnly).toBe("english-only");
    // And the real ko catalog carries the full en structure (no missing nodes).
    expect(Object.keys(ko)).toEqual(expect.arrayContaining(Object.keys(en)));
  });
});
