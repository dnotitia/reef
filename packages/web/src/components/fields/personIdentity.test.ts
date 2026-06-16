// @vitest-environment node

import { describe, expect, it } from "vitest";
import { computeInitials, hashKey, resolveIdentity } from "./personIdentity";

describe("computeInitials", () => {
  it("uses a single glyph for a leading CJK / Hangul name", () => {
    expect(computeInitials("홍길동")).toBe("홍");
    expect(computeInitials("田中太郎")).toBe("田");
  });

  it("uses two uppercased letters for multi-word Latin names", () => {
    expect(computeInitials("Alice Example")).toBe("AE");
    expect(computeInitials("alex rivera")).toBe("AR");
  });

  it("uses the first two letters for a single Latin token (login)", () => {
    expect(computeInitials("alice")).toBe("AL");
    expect(computeInitials("a")).toBe("A");
  });

  it("falls back to '?' for an empty / whitespace name", () => {
    expect(computeInitials("")).toBe("?");
    expect(computeInitials("   ")).toBe("?");
  });
});

describe("hashKey", () => {
  it("is deterministic for the same key", () => {
    expect(hashKey("alice")).toBe(hashKey("alice"));
  });

  it("separates distinct keys (no trivial collision on close logins)", () => {
    expect(hashKey("alice")).not.toBe(hashKey("alicf"));
  });
});

describe("resolveIdentity", () => {
  it("derives glyph and hash from the same key", () => {
    const resolved = resolveIdentity("alice");
    expect(resolved.initials).toBe("AL");
    expect(resolved.hash).toBe(hashKey("alice"));
  });

  it("returns the memoized instance on repeat lookups", () => {
    const first = resolveIdentity("jimin");
    const second = resolveIdentity("jimin");
    expect(second).toBe(first);
  });
});
