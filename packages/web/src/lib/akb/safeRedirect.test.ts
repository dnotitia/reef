// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildPathWithParams,
  isSafeSameOriginPath,
  normalizeSafeRedirect,
} from "./safeRedirect";

describe("safe redirect helpers", () => {
  it("accepts only same-origin paths", () => {
    expect(isSafeSameOriginPath("/issues?status=open")).toBe(true);
    expect(isSafeSameOriginPath("https://example.com")).toBe(false);
    expect(isSafeSameOriginPath("//example.com")).toBe(false);
    expect(isSafeSameOriginPath("/\\evil")).toBe(false);
    expect(isSafeSameOriginPath("/\n//example.com")).toBe(false);
    expect(isSafeSameOriginPath("/%0A//example.com")).toBe(false);
    expect(isSafeSameOriginPath(null)).toBe(false);
  });

  it("normalizes unsafe redirects to root", () => {
    expect(normalizeSafeRedirect("/issues")).toBe("/issues");
    expect(normalizeSafeRedirect("https://example.com")).toBe("/");
  });

  it("builds a path with encoded query params", () => {
    expect(
      buildPathWithParams("/login/sso-complete", {
        state: "nonce",
        next: "/issues?status=open",
      }),
    ).toBe("/login/sso-complete?state=nonce&next=%2Fissues%3Fstatus%3Dopen");
  });
});
