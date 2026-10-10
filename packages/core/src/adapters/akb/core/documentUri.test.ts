import { describe, expect, it } from "vitest";
import { parseAkbDocumentUri } from "./documentUri";

describe("parseAkbDocumentUri", () => {
  it("parses bare and collection-backed document paths", () => {
    expect(parseAkbDocumentUri("akb://reef-test/doc/root.md")).toEqual({
      vault: "reef-test",
      path: "root.md",
    });
    expect(
      parseAkbDocumentUri("akb://reef-test/coll/research/doc/report.md"),
    ).toEqual({ vault: "reef-test", path: "research/report.md" });
  });

  it("keeps the greedy final marker semantics for nested document markers", () => {
    expect(
      parseAkbDocumentUri("akb://reef-test/coll/a/doc/b/doc/c.md"),
    ).toEqual({ vault: "reef-test", path: "a/doc/b/c.md" });
    expect(parseAkbDocumentUri("akb://reef-test/coll/a/doc/b/doc/")).toEqual({
      vault: "reef-test",
      path: "a/b/doc/",
    });
    expect(parseAkbDocumentUri("akb://reef-test/doc/a/doc/b.md")).toEqual({
      vault: "reef-test",
      path: "a/doc/b.md",
    });
  });

  it("rejects empty, unsupported, and line-broken document paths", () => {
    for (const uri of [
      "akb://reef-test/doc/",
      "akb://reef-test/coll//doc/report.md",
      "akb://reef-test/coll/research/doc/",
      "akb://reef-test/coll/re\nsearch/doc/report.md",
      "akb://reef-test/coll/research/doc/report\n.md",
      "akb://reef-test/doc/report\r.md",
      "akb://reef-test/table/issues",
      "akb:///doc/root.md",
    ]) {
      expect(parseAkbDocumentUri(uri), uri).toBeNull();
    }
  });

  it("retains the existing authority and malformed-marker boundaries", () => {
    expect(parseAkbDocumentUri("akb://reef\ntest/doc/root.md")).toEqual({
      vault: "reef\ntest",
      path: "root.md",
    });

    const repeatedMalformedMarkers = `akb://reef-test/coll/${"a/doc/".repeat(64)}a\n/doc/root.md`;
    expect(parseAkbDocumentUri(repeatedMalformedMarkers)).toBeNull();
  });
});
