// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  akbDocumentBreadcrumb,
  akbDocumentSlugTitle,
  buildAkbDocumentUrl,
  parseAkbDocumentUri,
} from "./documentUri";

describe("parseAkbDocumentUri", () => {
  it("parses the location-aware coll form with a nested collection", () => {
    expect(
      parseAkbDocumentUri("akb://reef-test/coll/overview/reef/doc/pm-model.md"),
    ).toEqual({
      vault: "reef-test",
      collection: "overview/reef",
      slug: "pm-model.md",
    });
  });

  it("parses the bare doc form (no collection)", () => {
    expect(
      parseAkbDocumentUri("akb://reef-test/doc/issues/reef-001.md"),
    ).toEqual({
      vault: "reef-test",
      collection: undefined,
      slug: "issues/reef-001.md",
    });
  });

  it("returns null for a non-akb URI", () => {
    expect(parseAkbDocumentUri("https://example.com/x")).toBeNull();
  });
});

describe("akbDocumentBreadcrumb", () => {
  it("joins vault and collection", () => {
    expect(
      akbDocumentBreadcrumb("akb://reef-test/coll/overview/doc/x.md"),
    ).toBe("reef-test · overview");
  });

  it("falls back to the vault alone when there is no collection", () => {
    expect(akbDocumentBreadcrumb("akb://reef-test/doc/x.md")).toBe("reef-test");
  });
});

describe("akbDocumentSlugTitle", () => {
  it("strips the .md extension for a fallback title", () => {
    expect(akbDocumentSlugTitle("akb://v/coll/x/doc/pm-model.md")).toBe(
      "pm-model",
    );
  });
});

describe("buildAkbDocumentUrl", () => {
  it("returns null when no akb web base is configured", () => {
    expect(buildAkbDocumentUrl(null, "akb://v/coll/x/doc/y.md")).toBeNull();
  });

  it("builds the akb /vault/:name/doc/:encodedPath route, trimming a trailing slash", () => {
    expect(
      buildAkbDocumentUrl(
        "https://akb.example.com/",
        "akb://reef-test/coll/overview/doc/spec.md",
      ),
    ).toBe("https://akb.example.com/vault/reef-test/doc/overview%2Fspec.md");
  });

  it("builds from the bare form without a collection", () => {
    expect(
      buildAkbDocumentUrl(
        "https://akb.example.com",
        "akb://reef-test/doc/issues/reef-001.md",
      ),
    ).toBe("https://akb.example.com/vault/reef-test/doc/issues%2Freef-001.md");
  });

  it("returns null for an unparseable URI", () => {
    expect(
      buildAkbDocumentUrl("https://akb.example.com", "not-a-uri"),
    ).toBeNull();
  });
});
