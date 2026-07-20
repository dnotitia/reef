// @vitest-environment node

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPIRED_JWT,
  FUTURE_EXP,
  makeJwt,
} from "../../app/api/__test-helpers__/jwt";
import {
  getAkbAdapter,
  getAkbCurrentActor,
  resolveOptionalActor,
  respondWithError,
} from "./requestHelpers";

/**
 * REEF-324: the default-view read path resolves its scope actor straight from
 * the session-cookie JWT claims, paying an akb `/auth/me` round-trip when
 * the token carries no public-identifier claim. These tests pin both branches.
 */

function requestWithSession(jwt: string): Request {
  return new Request("https://reef.test/api/issues?vault=reef-acme", {
    headers: { cookie: `${SESSION_COOKIE}=${jwt}` },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveOptionalActor", () => {
  it("decodes the actor from the cookie JWT claim with no akb round-trip", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("resolveOptionalActor should not hit the network");
    });
    vi.stubGlobal("fetch", fetchMock);

    const jwt = makeJwt({ exp: FUTURE_EXP, username: "alice" });
    const actor = await resolveOptionalActor(requestWithSession(jwt));

    expect(actor).toBe("alice");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to /auth/me when the token carries no username claim", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ username: "bob" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // exp claim — no username claim to decode.
    const jwt = makeJwt({ exp: FUTURE_EXP });
    const actor = await resolveOptionalActor(requestWithSession(jwt));

    expect(actor).toBe("bob");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a sub/preferred_username-only token and resolves the canonical /auth/me actor", async () => {
    // A `sub` (opaque UUID) or SSO `preferred_username` need NOT equal the akb
    // username stored in `assigned_to`, so the fast path should not use them —
    // it defers to /auth/me, whose `username` is the value the My-Issues filter
    // needs (REEF-324).
    vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ username: "alice" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const jwt = makeJwt({
      exp: FUTURE_EXP,
      sub: "8b1c-uuid",
      preferred_username: "alice-kc",
    });
    const actor = await resolveOptionalActor(requestWithSession(jwt));

    expect(actor).toBe("alice");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null (and no round-trip) when the session cookie is missing", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("resolveOptionalActor should not hit the network");
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = new Request("https://reef.test/api/issues?vault=reef-acme");
    expect(await resolveOptionalActor(req)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the session cookie is expired", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("resolveOptionalActor should not hit the network");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await resolveOptionalActor(requestWithSession(EXPIRED_JWT)),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("respondWithError", () => {
  it("clears the Reef session when AKB rejects a suspended account", async () => {
    const response = await respondWithError(
      new AuthError({
        origin: "akb",
        code: "account_suspended",
        status: 403,
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toContain("__reef_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("x-reef-auth-invalidated")).toBe("1");
    expect(response.headers.get("x-reef-account-error")).toBe(
      "account_suspended",
    );
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/suspended/i),
    });
  });

  it("does not clear the Reef session for a non-AKB auth error", async () => {
    const response = await respondWithError(new AuthError());
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-reef-auth-invalidated")).toBeNull();
    expect(response.headers.get("x-reef-account-error")).toBeNull();
  });

  it("does not clear the Reef session for an AKB permission denial", async () => {
    const response = await respondWithError(
      new AuthError({
        origin: "akb",
        code: "permission_denied",
        status: 403,
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-reef-auth-invalidated")).toBeNull();
  });
});

describe("getAkbAdapter", () => {
  it("clears established auth when the local session cookie is expired", async () => {
    const result = getAkbAdapter(requestWithSession(EXPIRED_JWT));

    expect(result).toHaveProperty("response");
    if (!("response" in result)) throw new Error("expected auth response");
    const response = await result.response;
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toContain("__reef_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-reef-auth-invalidated")).toBe("1");
  });

  it("does not clear SSO state for a request with no session cookie", async () => {
    const result = getAkbAdapter(
      new Request("https://reef.test/api/issues?vault=reef-acme"),
    );

    expect(result).toHaveProperty("response");
    if (!("response" in result)) throw new Error("expected auth response");
    expect((await result.response).headers.get("set-cookie")).toBeNull();
    expect(
      (await result.response).headers.get("x-reef-auth-invalidated"),
    ).toBeNull();
  });
});

describe("getAkbCurrentActor", () => {
  it("clears established auth when the local session cookie is expired", async () => {
    const result = await getAkbCurrentActor(requestWithSession(EXPIRED_JWT));

    expect(result).toHaveProperty("response");
    if (!("response" in result)) throw new Error("expected auth response");
    expect(result.response.status).toBe(401);
    expect(result.response.headers.get("set-cookie")).toContain(
      "__reef_session=",
    );
    expect(result.response.headers.get("cache-control")).toBe("no-store");
    expect(result.response.headers.get("x-reef-auth-invalidated")).toBe("1");
  });

  it("preserves an AKB account denial and clears established auth", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "membership_required",
            message: "membership required",
          }),
          { status: 403 },
        ),
      ),
    );

    const result = await getAkbCurrentActor(
      requestWithSession(makeJwt({ exp: FUTURE_EXP, username: "alice" })),
    );

    expect(result).toHaveProperty("response");
    if (!("response" in result)) throw new Error("expected auth response");
    expect(result.response.status).toBe(403);
    expect((await result.response.json()).error).toMatch(/workspace|member/i);
    expect(result.response.headers.get("set-cookie")).toContain(
      "__reef_session=",
    );
    expect(result.response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(result.response.headers.get("x-reef-auth-invalidated")).toBe("1");
  });
});
