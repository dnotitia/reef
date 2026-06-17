import { describe, expect, it } from "vitest";
import { stripTrailingSlashes } from "./url";

describe("stripTrailingSlashes", () => {
  it("leaves values without trailing slashes unchanged", () => {
    expect(stripTrailingSlashes("https://akb.test")).toBe("https://akb.test");
  });

  it("removes one trailing slash", () => {
    expect(stripTrailingSlashes("https://akb.test/")).toBe("https://akb.test");
  });

  it("removes repeated trailing slashes", () => {
    expect(stripTrailingSlashes("https://akb.test////")).toBe(
      "https://akb.test",
    );
  });

  it("preserves non-trailing slashes", () => {
    expect(stripTrailingSlashes("https://akb.test/api/v1")).toBe(
      "https://akb.test/api/v1",
    );
  });

  it("handles empty and slash-only values", () => {
    expect(stripTrailingSlashes("")).toBe("");
    expect(stripTrailingSlashes("///")).toBe("");
  });
});
