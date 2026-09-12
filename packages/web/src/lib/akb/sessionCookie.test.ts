// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthInvalidationCookie,
  buildClearedAuthCookies,
  buildClearedAuthInvalidationCookie,
  buildSessionCookie,
  decodeSessionActor,
  decodeSessionUsername,
  parseCookieHeader,
} from "./sessionCookie";

function jwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${body}.signature`;
}

describe("local session cookies", () => {
  it("sets an httpOnly local session with bounded lifetime", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(
      buildSessionCookie("jwt", { maxAgeSeconds: 10, secure: false }),
    ).toBe("__reef_session=jwt; HttpOnly; SameSite=Lax; Path=/; Max-Age=10");
    vi.unstubAllEnvs();
  });

  it("clears only the local carrier", () => {
    const cleared = buildClearedAuthCookies({ secure: false });
    expect(cleared).toEqual([
      "__reef_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    ]);
  });

  it("uses a non-secret invalidation marker", () => {
    expect(buildAuthInvalidationCookie({ secure: false })).toContain(
      "__reef_auth_invalidated=1",
    );
    expect(buildClearedAuthInvalidationCookie({ secure: false })).toContain(
      "Max-Age=0",
    );
  });

  it("parses cookies and reads only public identity claims", () => {
    const token = jwt({ username: "alice", sub: "subject" });
    expect(
      parseCookieHeader(`a=1; __reef_session=${encodeURIComponent(token)}`),
    ).toMatchObject({
      a: "1",
      __reef_session: token,
    });
    expect(decodeSessionUsername(token)).toBe("alice");
    expect(decodeSessionActor(token)).toBe("alice");
  });
});
