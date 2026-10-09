import { describe, expect, it } from "vitest";
import {
  extractAkbDocumentUris,
  normalizeAkbDocumentMarkdownLinks,
  normalizeExistingAkbDocumentMarkdownLinks,
} from "./markdownDocumentLinks";

const URI = "akb://reef-test/coll/research/doc/report.md";
const BRACKET_TITLE = "[Plan] 260811 - 전체";
const BRACKET_TITLES = new Map([[URI, BRACKET_TITLE]]);

describe("normalizeAkbDocumentMarkdownLinks", () => {
  it("converts bare AKB document URIs into Markdown links", () => {
    expect(normalizeAkbDocumentMarkdownLinks(`See ${URI}.`)).toBe(
      `See [report](${URI}).`,
    );
  });

  it("uses resolved document titles for auto-generated link text", () => {
    const titles = new Map([[URI, "Research Report"]]);

    expect(normalizeAkbDocumentMarkdownLinks(`[report](${URI})`, titles)).toBe(
      `[Research Report](${URI})`,
    );
    expect(normalizeAkbDocumentMarkdownLinks(URI, titles)).toBe(
      `[Research Report](${URI})`,
    );
  });

  it("keeps bare AKB document URIs when normalizing only existing links", () => {
    expect(normalizeExistingAkbDocumentMarkdownLinks(`See ${URI}.`)).toBe(
      `See ${URI}.`,
    );
  });

  it("preserves user-authored link text", () => {
    const titles = new Map([[URI, "Research Report"]]);

    expect(
      normalizeAkbDocumentMarkdownLinks(`[Custom title](${URI})`, titles),
    ).toBe(`[Custom title](${URI})`);
  });

  it("is idempotent for titles that start with brackets", () => {
    const once = normalizeAkbDocumentMarkdownLinks(URI, BRACKET_TITLES);
    const twice = normalizeAkbDocumentMarkdownLinks(once, BRACKET_TITLES);
    const thrice = normalizeAkbDocumentMarkdownLinks(twice, BRACKET_TITLES);
    const fourTimes = normalizeAkbDocumentMarkdownLinks(thrice, BRACKET_TITLES);

    expect(once).toBe(`[\\[Plan\\] 260811 - 전체](${URI})`);
    expect(twice).toBe(once);
    expect(thrice).toBe(once);
    expect(fourTimes).toBe(once);
    expect(fourTimes.length).toBe(once.length);
  });

  it("recognizes existing links whose labels escape brackets", () => {
    const existingLinks = [
      `[\\[Plan\\] 260811 - 전체](${URI})`,
      String.raw`[\\[Plan\\] 260811 - 전체](${URI})`,
    ];

    for (const existing of existingLinks) {
      expect(normalizeAkbDocumentMarkdownLinks(existing, BRACKET_TITLES)).toBe(
        existing,
      );
      expect(extractAkbDocumentUris(existing)).toEqual([URI]);
    }
  });

  it("leaves non-document akb URIs untouched", () => {
    expect(
      normalizeAkbDocumentMarkdownLinks(
        "akb://reef-test/table/pipeline akb://reef-test/file/abc",
      ),
    ).toBe("akb://reef-test/table/pipeline akb://reef-test/file/abc");
  });
});

describe("extractAkbDocumentUris", () => {
  it("extracts unique document URIs from bare text and Markdown links", () => {
    expect(extractAkbDocumentUris(URI)).toEqual([URI]);
    expect(
      extractAkbDocumentUris(`${URI}\n[Report](${URI})\nakb://v/file/abc`),
    ).toEqual([URI]);
  });
});
