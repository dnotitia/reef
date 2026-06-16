// @vitest-environment node
import { AuthError } from "@reef/core";
import { describe, expect, it } from "vitest";
import { extractGithubToken } from "./extractGithubToken";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/issues", { headers });
}

function makeReadonlyHeaders(headers: Record<string, string>): Headers {
  // Next.js ReadonlyHeaders is structurally compatible with Headers;
  // in tests we use the standard Headers class which satisfies the interface.
  const h = new Headers();
  for (const [k, v] of Object.entries(headers)) {
    h.set(k, v);
  }
  return h;
}

describe("extractGithubToken — Request input", () => {
  it("extracts token from a valid Bearer header", () => {
    const req = makeRequest({ Authorization: "Bearer ghp_abc123" });
    expect(extractGithubToken(req)).toBe("ghp_abc123");
  });

  it("throws AuthError when token is empty after Bearer prefix (header value normalized by platform)", () => {
    const req = makeRequest({ Authorization: "Bearer " });
    expect(() => extractGithubToken(req)).toThrow(AuthError);
  });

  it("throws AuthError when authorization header is missing", () => {
    const req = makeRequest({});
    expect(() => extractGithubToken(req)).toThrow(AuthError);
  });

  it("AuthError for missing header carries diagnostic context", () => {
    const req = makeRequest({});
    try {
      extractGithubToken(req);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).context.message).toBe(
        "missing_authorization_header",
      );
    }
  });

  it("throws AuthError when authorization header has no Bearer prefix", () => {
    const req = makeRequest({ Authorization: "ghp_abc123" });
    expect(() => extractGithubToken(req)).toThrow(AuthError);
  });

  it("AuthError for malformed header carries diagnostic context", () => {
    const req = makeRequest({ Authorization: "ghp_abc123" });
    try {
      extractGithubToken(req);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).context.message).toBe(
        "malformed_authorization_header",
      );
    }
  });

  it("throws AuthError when authorization uses Basic scheme", () => {
    const req = makeRequest({ Authorization: "Basic dXNlcjpwYXNz" });
    expect(() => extractGithubToken(req)).toThrow(AuthError);
  });

  it("handles lowercase authorization header name", () => {
    // Web API Request normalizes header names to lowercase
    const req = makeRequest({ authorization: "Bearer ghp_lowercase" });
    expect(extractGithubToken(req)).toBe("ghp_lowercase");
  });
});

describe("extractGithubToken — ReadonlyHeaders input", () => {
  it("extracts token from a valid Bearer header via ReadonlyHeaders", () => {
    const h = makeReadonlyHeaders({ authorization: "Bearer ghp_readonly" });
    expect(extractGithubToken(h)).toBe("ghp_readonly");
  });

  it("throws AuthError when authorization header is missing via ReadonlyHeaders", () => {
    const h = makeReadonlyHeaders({});
    expect(() => extractGithubToken(h)).toThrow(AuthError);
  });

  it("throws AuthError when authorization has no Bearer prefix via ReadonlyHeaders", () => {
    const h = makeReadonlyHeaders({ authorization: "ghp_noprefx" });
    expect(() => extractGithubToken(h)).toThrow(AuthError);
  });
});
