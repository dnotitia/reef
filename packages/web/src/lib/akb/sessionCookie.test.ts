// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  SSO_START_COOKIE,
  buildClearedAuthCookies,
  buildClearedEstablishedAuthCookies,
  buildClearedSessionCookie,
  buildClearedSsoCookies,
  buildClearedSsoStartCookie,
  buildSessionCookie,
  buildSsoSessionHandleCookie,
  buildSsoStartCookie,
  decodeJwtExp,
  decodeSessionActor,
  decodeSessionUsername,
  isJwtExpired,
  parseCookieHeader,
} from "./sessionCookie";

function makeJwt(payload: object): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig-not-verified`;
}

describe("buildSessionCookie", () => {
  it("serializes a JWT with HttpOnly, SameSite=Lax, Path=/, Max-Age", () => {
    const out = buildSessionCookie("abc.def.ghi", {
      maxAgeSeconds: 3600,
      secure: false,
    });
    expect(out).toBe(
      `${SESSION_COOKIE}=abc.def.ghi; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
    );
  });

  it("adds Secure when secure: true", () => {
    const out = buildSessionCookie("jwt", { maxAgeSeconds: 60, secure: true });
    expect(out.endsWith("; Secure")).toBe(true);
  });

  it("defaults Max-Age to 24h", () => {
    const out = buildSessionCookie("jwt", { secure: false });
    expect(out).toContain("Max-Age=86400");
  });
});

describe("buildClearedSessionCookie", () => {
  it("emits an empty-value cookie with Max-Age=0", () => {
    const out = buildClearedSessionCookie({ secure: false });
    expect(out).toBe(
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    );
  });
});

describe("buildSsoSessionHandleCookie", () => {
  it("accepts only a random opaque handle, never JWT or token material", () => {
    const handle = Buffer.alloc(32, 6).toString("base64url");
    expect(
      buildSsoSessionHandleCookie(handle, {
        maxAgeSeconds: 300,
        secure: false,
      }),
    ).toBe(
      `${SESSION_COOKIE}=${handle}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`,
    );
    expect(() =>
      buildSsoSessionHandleCookie("header.payload.signature"),
    ).toThrow("sso_session_handle_invalid");
  });
});

describe("SSO cookie helpers", () => {
  it("serializes the short-lived SSO start cookie", () => {
    const binding = Buffer.alloc(32, 7).toString("base64url");
    const out = buildSsoStartCookie(binding, { secure: false });
    expect(out).toBe(
      `${SSO_START_COOKIE}=${binding}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
    );
    expect(() => buildSsoStartCookie("not-random")).toThrow(
      "sso_browser_binding_invalid",
    );
  });

  it("clears the SSO start cookie", () => {
    expect(buildClearedSsoStartCookie({ secure: false })).toBe(
      `${SSO_START_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    );
  });

  it("clears the session and SSO cookies together", () => {
    expect(buildClearedAuthCookies({ secure: false })).toEqual([
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_id_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `${SSO_START_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_logout=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_logout_id_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    ]);
  });

  it("clears only SSO cookies for password-login transitions", () => {
    expect(buildClearedSsoCookies({ secure: false })).toEqual([
      `__reef_sso=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_id_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `${SSO_START_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_logout=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_logout_id_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    ]);
  });

  it("clears established auth cookies without deleting an in-flight SSO nonce", () => {
    expect(buildClearedEstablishedAuthCookies({ secure: false })).toEqual([
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_id_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_logout=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
      `__reef_sso_logout_id_token=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    ]);
  });
});

describe("decodeJwtExp", () => {
  it("returns the exp claim from a valid JWT payload", () => {
    const jwt = makeJwt({ exp: 1234567890, sub: "alice" });
    expect(decodeJwtExp(jwt)).toBe(1234567890);
  });

  it("returns null when exp is missing", () => {
    const jwt = makeJwt({ sub: "alice" });
    expect(decodeJwtExp(jwt)).toBeNull();
  });

  it("returns null when the JWT has fewer than 2 segments", () => {
    expect(decodeJwtExp("only-one-segment")).toBeNull();
  });

  it("returns null when payload segment is not parseable as JSON", () => {
    // "a.b.c" splits, but base64-decoding "b" yields non-JSON bytes.
    expect(decodeJwtExp("a.b.c")).toBeNull();
  });

  it("returns null when payload is not valid JSON", () => {
    const jwt = `header.${Buffer.from("not-json").toString("base64url")}.sig`;
    expect(decodeJwtExp(jwt)).toBeNull();
  });
});

describe("decodeSessionActor", () => {
  it("prefers username over preferred_username and sub", () => {
    const jwt = makeJwt({
      username: "alice",
      preferred_username: "alice-kc",
      sub: "uuid-1",
    });
    expect(decodeSessionActor(jwt)).toBe("alice");
  });

  it("falls back to preferred_username, then sub", () => {
    expect(
      decodeSessionActor(makeJwt({ preferred_username: "bob-kc", sub: "x" })),
    ).toBe("bob-kc");
    expect(decodeSessionActor(makeJwt({ sub: "uuid-2" }))).toBe("uuid-2");
  });

  it("trims whitespace and skips empty/non-string claims", () => {
    expect(decodeSessionActor(makeJwt({ username: "  carol  " }))).toBe(
      "carol",
    );
    expect(decodeSessionActor(makeJwt({ username: "", sub: "uuid-3" }))).toBe(
      "uuid-3",
    );
    expect(decodeSessionActor(makeJwt({ username: 42, sub: "uuid-4" }))).toBe(
      "uuid-4",
    );
  });

  it("returns null when no actor claim is present or the token is malformed", () => {
    expect(decodeSessionActor(makeJwt({ exp: 123 }))).toBeNull();
    expect(decodeSessionActor("only-one-segment")).toBeNull();
    expect(
      decodeSessionActor(
        `h.${Buffer.from("not-json").toString("base64url")}.s`,
      ),
    ).toBeNull();
  });
});

describe("decodeSessionUsername", () => {
  it("returns the username claim", () => {
    expect(decodeSessionUsername(makeJwt({ username: "  alice  " }))).toBe(
      "alice",
    );
  });

  it("ignores preferred_username and sub (only username matches assigned_to)", () => {
    expect(
      decodeSessionUsername(
        makeJwt({ preferred_username: "alice-kc", sub: "uuid-1" }),
      ),
    ).toBeNull();
    expect(decodeSessionUsername(makeJwt({ sub: "uuid-2" }))).toBeNull();
  });

  it("returns null for an empty/non-string username or a malformed token", () => {
    expect(decodeSessionUsername(makeJwt({ username: "" }))).toBeNull();
    expect(decodeSessionUsername(makeJwt({ username: 42 }))).toBeNull();
    expect(decodeSessionUsername("only-one-segment")).toBeNull();
  });
});

describe("isJwtExpired", () => {
  it("returns true when exp is past", () => {
    const jwt = makeJwt({ exp: 100 });
    expect(isJwtExpired(jwt, 200)).toBe(true);
  });

  it("returns false when exp is future", () => {
    const jwt = makeJwt({ exp: 1000 });
    expect(isJwtExpired(jwt, 500)).toBe(false);
  });

  it("returns false when exp is absent (akb backend will judge)", () => {
    const jwt = makeJwt({ sub: "alice" });
    expect(isJwtExpired(jwt, 999999)).toBe(false);
  });
});

describe("parseCookieHeader", () => {
  it("parses single cookie", () => {
    expect(parseCookieHeader("__reef_session=abc")).toEqual({
      __reef_session: "abc",
    });
  });

  it("parses multiple cookies separated by '; '", () => {
    expect(
      parseCookieHeader("a=1; b=2; __reef_session=jwt.payload.sig"),
    ).toEqual({
      a: "1",
      b: "2",
      __reef_session: "jwt.payload.sig",
    });
  });

  it("returns empty object for null/undefined/empty input", () => {
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });

  it("ignores malformed pairs", () => {
    expect(parseCookieHeader("no-equals; valid=ok")).toEqual({ valid: "ok" });
  });

  it("URI-decodes values", () => {
    expect(parseCookieHeader("k=hello%20world")).toEqual({ k: "hello world" });
  });

  it("keeps malformed percent escapes from aborting cookie parsing", () => {
    expect(parseCookieHeader("bad=%E0%A4%A; __reef_sso=1")).toEqual({
      bad: "%E0%A4%A",
      __reef_sso: "1",
    });
  });
});
