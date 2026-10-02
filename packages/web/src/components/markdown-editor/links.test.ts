// @vitest-environment node

import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./links";

describe("normalizeUrl", () => {
  it("preserves canonical AKB document and file URIs", () => {
    expect(normalizeUrl("akb://reef-test/coll/docs/doc/plan.md")).toBe(
      "akb://reef-test/coll/docs/doc/plan.md",
    );
    expect(normalizeUrl("akb://reef-test/issues/file/file-1")).toBe(
      "akb://reef-test/issues/file/file-1",
    );
  });

  it("rejects unsupported AKB resources and keeps URL normalization", () => {
    expect(normalizeUrl("akb://reef-test/table/pipeline")).toBeNull();
    expect(normalizeUrl("  ")).toBeNull();
    expect(normalizeUrl("example.com/reef")).toBe("https://example.com/reef");
  });
});
