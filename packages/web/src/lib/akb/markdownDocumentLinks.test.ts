import { describe, expect, it } from "vitest";
import {
  extractAkbDocumentUris,
  normalizeAkbDocumentMarkdownLinks,
  retargetRenderedAkbDocumentLinks,
} from "./markdownDocumentLinks";

const URI = "akb://reef-test/coll/research/doc/report.md";

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

  it("leaves non-document akb URIs untouched", () => {
    expect(
      normalizeAkbDocumentMarkdownLinks("akb://reef-test/table/pipeline"),
    ).toBe("akb://reef-test/table/pipeline");
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
  });
});
