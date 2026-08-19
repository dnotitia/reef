// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ssoAutoRedirectEnabled } from "./ssoAutoRedirect";

describe("ssoAutoRedirectEnabled", () => {
  it("is off by default", () => {
    expect(ssoAutoRedirectEnabled(undefined)).toBe(false);
  });

  it.each(["1", "true"])("accepts %s", (value) => {
    expect(ssoAutoRedirectEnabled(value)).toBe(true);
  });

  it.each(["0", "false", "", "yes", "TRUE"])("rejects %s", (value) => {
    expect(ssoAutoRedirectEnabled(value)).toBe(false);
  });
});
