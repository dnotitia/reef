// @vitest-environment node
import { AuthError } from "@reef/core";
import { describe, expect, it } from "vitest";
import { extractAkbSession } from "./extractAkbSession";
import { SESSION_COOKIE } from "./sessionCookie";

function makeJwt(payload: object): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function makeRequest(cookieHeader?: string): Request {
  const headers: Record<string, string> = {};
  if (cookieHeader) headers.cookie = cookieHeader;
  return new Request("http://localhost/api/auth/akb/me", { headers });
}

const farFutureExp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
const pastExp = Math.floor(Date.now() / 1000) - 60;

describe("extractAkbSession", () => {
  it("returns the JWT from a valid __reef_session cookie", () => {
    const jwt = makeJwt({ exp: farFutureExp, sub: "alice" });
    const req = makeRequest(`${SESSION_COOKIE}=${jwt}`);
    expect(extractAkbSession(req)).toBe(jwt);
  });

  it("throws AuthError when cookie header is absent", () => {
    const req = makeRequest();
    expect(() => extractAkbSession(req)).toThrow(AuthError);
  });

  it("AuthError context distinguishes missing cookie", () => {
    try {
      extractAkbSession(makeRequest());
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as AuthError).context.message).toBe("missing_session_cookie");
    }
  });

  it("throws AuthError when __reef_session cookie is missing among other cookies", () => {
    const req = makeRequest("other=1; another=2");
    expect(() => extractAkbSession(req)).toThrow(AuthError);
  });

  it("throws AuthError when JWT is expired", () => {
    const jwt = makeJwt({ exp: pastExp });
    const req = makeRequest(`${SESSION_COOKIE}=${jwt}`);
    expect(() => extractAkbSession(req)).toThrow(AuthError);
  });

  it("AuthError context distinguishes expired cookie", () => {
    const jwt = makeJwt({ exp: pastExp });
    try {
      extractAkbSession(makeRequest(`${SESSION_COOKIE}=${jwt}`));
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as AuthError).context.message).toBe("expired_session_cookie");
    }
  });

  it("ignores client-provided Authorization header (cookie is the only source of truth)", () => {
    const req = new Request("http://localhost/api/auth/akb/me", {
      headers: { authorization: "Bearer client-injected-token" },
    });
    expect(() => extractAkbSession(req)).toThrow(AuthError);
  });
});
