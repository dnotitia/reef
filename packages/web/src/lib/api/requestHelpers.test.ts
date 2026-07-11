// @vitest-environment node

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { AuthError } from "@reef/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPIRED_JWT,
  FUTURE_EXP,
  makeJwt,
} from "../../app/api/__test-helpers__/jwt";
import { resolveOptionalActor, respondWithError } from "./requestHelpers";

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
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/suspended/i),
    });
  });

  it("does not clear the Reef session for a non-AKB auth error", async () => {
    const response = await respondWithError(new AuthError());
    expect(response.headers.get("set-cookie")).toBeNull();
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
  });
});
