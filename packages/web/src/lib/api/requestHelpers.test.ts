// @vitest-environment node

import { SESSION_COOKIE } from "@/lib/akb/sessionCookie";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXPIRED_JWT,
  FUTURE_EXP,
  makeJwt,
} from "../../app/api/__test-helpers__/jwt";
import { resolveOptionalActor } from "./requestHelpers";

/**
 * REEF-324: the default-view read path resolves its scope actor straight from
 * the session-cookie JWT claims, paying an akb `/auth/me` round-trip only when
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

  it("falls back to /auth/me when the token carries no actor claim", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ username: "bob" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // exp only — no username / preferred_username / sub claim to decode.
    const jwt = makeJwt({ exp: FUTURE_EXP });
    const actor = await resolveOptionalActor(requestWithSession(jwt));

    expect(actor).toBe("bob");
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
