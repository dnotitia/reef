// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function makeJwt(payload: object): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

const futureExp = Math.floor(Date.now() / 1000) + 60 * 60;
const pastExp = Math.floor(Date.now() / 1000) - 60;
const VALID_JWT = makeJwt({ exp: futureExp, sub: "user-1" });

function makeRequest(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/auth/akb/me", { headers });
}

describe("GET /api/auth/akb/me", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 401 and clears cookie when no session cookie present", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expectClearedAuthCookies(res);
  });

  it("returns 401 and clears cookie when JWT is expired", async () => {
    const expiredJwt = makeJwt({ exp: pastExp });
    const res = await GET(makeRequest(`__reef_session=${expiredJwt}`));
    expect(res.status).toBe(401);
    expectClearedAuthCookies(res);
  });

  it("forwards JWT as Bearer to akb /auth/me and proxies the body", async () => {
    const akbBody = {
      user_id: "u-1",
      username: "alice",
      email: "alice@example.com",
      display_name: "Alice",
      is_admin: false,
      auth_method: "jwt",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(akbBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await GET(makeRequest(`__reef_session=${VALID_JWT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(akbBody);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe("http://akb.test/api/v1/auth/me");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${VALID_JWT}`,
    });
  });

  it("returns 401 and clears cookie when akb backend returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 401 }),
    );
    const res = await GET(makeRequest(`__reef_session=${VALID_JWT}`));
    expect(res.status).toBe(401);
    expectClearedAuthCookies(res);
  });

  it("returns 502 on akb backend 5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("err", { status: 500 }),
    );
    const res = await GET(makeRequest(`__reef_session=${VALID_JWT}`));
    expect(res.status).toBe(502);
  });

  it("returns 502 (not 500) when akb /auth/me returns an unexpected 404", async () => {
    // The adapter ladder maps 404 → NotFoundError; the route should still collapse
    // every non-401 non-ok akb response to a PM-facing 502 (REEF-052 regression).
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 404 }),
    );
    const res = await GET(makeRequest(`__reef_session=${VALID_JWT}`));
    expect(res.status).toBe(502);
  });

  it("returns 502 on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    const res = await GET(makeRequest(`__reef_session=${VALID_JWT}`));
    expect(res.status).toBe(502);
  });

  it("does NOT honor a client-provided Authorization header", async () => {
    // A request with Authorization but no cookie should be 401.
    const req = new Request("http://localhost/api/auth/akb/me", {
      headers: { authorization: "Bearer client-faked-jwt" },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});

function expectClearedAuthCookies(res: Response) {
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("__reef_session=");
  expect(setCookie).toContain("__reef_sso=");
  expect(setCookie).toContain("__reef_sso_id_token=");
  expect(setCookie).not.toContain("__reef_sso_start=");
  expect(setCookie).toContain("Max-Age=0");
}
