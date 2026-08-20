import { describe, expect, it } from "vitest";
import {
  extractAkbDocumentUris,
  normalizeAkbDocumentMarkdownLinks,
  retargetRenderedAkbDocumentLinks,
} from "./markdownDocumentLinks";

const URI = "akb://reef-test/coll/research/doc/report.md";
const BRACKET_TITLE = "[Plan] 260811 - 전체";
const BRACKET_TITLES = new Map([[URI, BRACKET_TITLE]]);

describe("normalizeAkbDocumentMarkdownLinks", () => {
  it("converts bare akb document URIs into markdown links", () => {
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
  it("extracts unique document URIs from bare text and markdown links", () => {
    expect(
      extractAkbDocumentUris(`${URI}\n[Report](${URI})\nakb://v/file/abc`),
    ).toEqual([URI]);
  });
});

describe("retargetRenderedAkbDocumentLinks", () => {
  it("keeps the akb URI in data and points href at the configured akb web URL", () => {
    const root = document.createElement("div");
    root.innerHTML = `<a href="${URI}">Research Report</a>`;

    retargetRenderedAkbDocumentLinks(root, "https://akb.example.com/");

    const anchor = root.querySelector("a");
    expect(anchor?.dataset.akbUri).toBe(URI);
    expect(anchor?.getAttribute("href")).toBe(
      "https://akb.example.com/vault/reef-test/doc/research%2Freport.md",
    );
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toBe("noreferrer");
  });
});
