// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deepMerge, loadMessages } from "./messages";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

type CatalogNode = string | { [key: string]: CatalogNode };

/** Dot-joined paths to every string leaf in a catalog. */
function leafKeyPaths(node: CatalogNode, prefix = ""): string[] {
  if (typeof node === "string") return prefix ? [prefix] : [];
  return Object.entries(node).flatMap(([key, value]) =>
    leafKeyPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

function leafValue(catalog: CatalogNode, keyPath: string): unknown {
  return keyPath
    .split(".")
    .reduce<unknown>(
      (acc, key) => (acc as Record<string, unknown>)[key],
      catalog,
    );
}

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
  it("returns the en base (web strings + core field catalog) for the base locale", () => {
    const base = loadMessages("en");
    // The web string files are carried through unchanged...
    expect(base.settings).toEqual(en.settings);
    // ...and the core-owned field catalog is composed into `fields` (the
    // REEF-291 merge seam), issue groups flat and planning groups nested.
    expect(base.fields.status.todo).toBe("Todo");
    expect(base.fields.sortDirection.priority.desc).toBe("High → Low");
    expect(base.fields.planning.sprintStatus.active).toBe("Active");
  });

  it("overlays ko over the en base so present keys are translated", () => {
    const ko = loadMessages("ko");
    expect(ko.settings.preferences.language.heading).toBe("언어");
    // Core field labels resolve through the same overlay (AC1).
    expect(ko.fields.status.todo).toBe("할 일");
    expect(ko.fields.planning.releaseStatus.released).toBe("릴리스됨");
  });

  it("a key absent from ko falls back to the en value", () => {
    const ko = loadMessages("ko") as Record<string, unknown>;
    // Synthesize a base-locale key and confirm the merge would retain it: each
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

describe("catalog parity (REEF-293 AC2 — missing-key check)", () => {
  it("every ko key exists in the en base (no orphan translations)", () => {
    // The en base is the COMPOSED catalog, not raw en.json: REEF-292's core
    // field labels (`fields.*`) live in `@reef/core` and are merged in at load
    // time, while their ko translations live in ko.json. Compare against the
    // merged base so those ko `fields.*` keys are not flagged as orphans.
    const enKeys = new Set(leafKeyPaths(loadMessages("en") as CatalogNode));
    const orphans = leafKeyPaths(ko as CatalogNode).filter(
      (keyPath) => !enKeys.has(keyPath),
    );
    expect(orphans, "ko keys absent from the en base catalog").toEqual([]);
  });

  it("every catalog leaf is a non-empty string", () => {
    for (const [label, catalog] of [
      ["en", en],
      ["ko", ko],
    ] as const) {
      for (const keyPath of leafKeyPaths(catalog as CatalogNode)) {
        const value = leafValue(catalog as CatalogNode, keyPath);
        expect(typeof value, `${label}.${keyPath}`).toBe("string");
        expect(
          (value as string).trim().length,
          `${label}.${keyPath}`,
        ).toBeGreaterThan(0);
      }
    }
  });
});
