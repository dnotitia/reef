import { describe, expect, it } from "vitest";
import {
  parseEnrichmentReferences,
  validateReferences,
} from "./enrichIssue/validation";

const DOC = "akb://v/coll/specs/doc/oauth.md";

describe("parseEnrichmentReferences", () => {
  it("extracts the references array from enrichment JSON", () => {
    const raw = JSON.stringify({
      suggestions: [],
      references: [{ uri: DOC, reasoning: "supports", confidence: 0.8 }],
    });
    expect(parseEnrichmentReferences(raw)).toHaveLength(1);
  });

  it("returns [] when references is absent (suggestions-only response)", () => {
    expect(
      parseEnrichmentReferences(JSON.stringify({ suggestions: [] })),
    ).toEqual([]);
  });

  it("returns [] for unparseable JSON rather than throwing", () => {
    expect(parseEnrichmentReferences("not json")).toEqual([]);
  });
});

describe("validateReferences", () => {
  it("keeps a valid akb document reference", () => {
    const out = validateReferences([
      { uri: DOC, reasoning: "supports", confidence: 0.8 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(DOC);
  });

  it("keeps a reference whose title is null (akb hit without a title)", () => {
    const out = validateReferences([
      { uri: DOC, title: null, reasoning: "supports", confidence: 0.8 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(DOC);
  });

  it("drops non-document / malformed entries and dedupes by uri", () => {
    const out = validateReferences([
      { uri: DOC, reasoning: "supports", confidence: 0.8 },
      { uri: DOC, reasoning: "dup", confidence: 0.5 },
      { uri: "https://example.com", reasoning: "web", confidence: 0.9 },
      { uri: "akb://v/table/pipeline", reasoning: "table", confidence: 0.7 },
      { uri: DOC, confidence: 0.4 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].uri).toBe(DOC);
  });
});
