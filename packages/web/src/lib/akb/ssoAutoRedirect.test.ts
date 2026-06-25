// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ssoAutoRedirectEnabled } from "./ssoAutoRedirect";

describe("ssoAutoRedirectEnabled", () => {
  it("is off by default (unset)", () => {
    expect(ssoAutoRedirectEnabled(undefined)).toBe(false);
  });

  it("accepts the documented truthy opt-ins", () => {
    expect(ssoAutoRedirectEnabled("1")).toBe(true);
    expect(ssoAutoRedirectEnabled("true")).toBe(true);
  });

  it("treats any other value as off (no surprise enablement)", () => {
    expect(ssoAutoRedirectEnabled("0")).toBe(false);
    expect(ssoAutoRedirectEnabled("false")).toBe(false);
    expect(ssoAutoRedirectEnabled("")).toBe(false);
    expect(ssoAutoRedirectEnabled("yes")).toBe(false);
    expect(ssoAutoRedirectEnabled("TRUE")).toBe(false);
  });
});
