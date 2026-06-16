// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { getReefPublicOrigin } from "./reefPublicOrigin";

describe("getReefPublicOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns null when unset (older same-site mode)", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "");
    expect(getReefPublicOrigin()).toBeNull();
  });

  it("returns the canonical origin for a bare https URL", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
    expect(getReefPublicOrigin()).toBe("https://reef.example.com");
  });

  it("drops a trailing slash (bare origin only)", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com/");
    expect(getReefPublicOrigin()).toBe("https://reef.example.com");
  });

  it("lowercases the host to match akb's _normalize_origin", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://REEF.Example.COM");
    expect(getReefPublicOrigin()).toBe("https://reef.example.com");
  });

  it("drops the default https port (:443) so it matches a bare allowlist entry", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com:443");
    expect(getReefPublicOrigin()).toBe("https://reef.example.com");
  });

  it("keeps a non-default port", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com:8443");
    expect(getReefPublicOrigin()).toBe("https://reef.example.com:8443");
  });

  it("allows http for localhost dev", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "http://localhost:3000");
    expect(getReefPublicOrigin()).toBe("http://localhost:3000");
  });

  it("allows http for a loopback IP", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "http://127.0.0.1:8080");
    expect(getReefPublicOrigin()).toBe("http://127.0.0.1:8080");
  });

  it("throws on a non-loopback http origin (cleartext code-leak guard)", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "http://reef.example.com");
    expect(() => getReefPublicOrigin()).toThrow(/https for non-loopback/);
  });

  it("throws on a value with no scheme", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "reef.example.com");
    expect(() => getReefPublicOrigin()).toThrow(/absolute origin URL/);
  });

  it("throws on a scheme-relative value", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "//reef.example.com");
    expect(() => getReefPublicOrigin()).toThrow(/absolute origin URL/);
  });

  it("throws on a non-http(s) scheme", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "ftp://reef.example.com");
    expect(() => getReefPublicOrigin()).toThrow(/http or https/);
  });

  it("throws when the value carries a path", () => {
    vi.stubEnv(
      "REEF_PUBLIC_ORIGIN",
      "https://reef.example.com/api/auth/akb/sso/callback",
    );
    expect(() => getReefPublicOrigin()).toThrow(/bare origin/);
  });

  it("throws when the value carries a query", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com/?x=1");
    expect(() => getReefPublicOrigin()).toThrow(/bare origin/);
  });

  it("throws when the value carries a fragment", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com#frag");
    expect(() => getReefPublicOrigin()).toThrow(/bare origin/);
  });

  it("throws on embedded credentials (origin-spoof guard)", () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://user:pass@reef.example.com");
    expect(() => getReefPublicOrigin()).toThrow(/credentials/);
  });
});
