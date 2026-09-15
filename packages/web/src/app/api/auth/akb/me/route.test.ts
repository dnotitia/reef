// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtimeRef = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/server/auth-v2/runtime", () => ({
  AuthV2RouteRuntimeError: class AuthV2RouteRuntimeError extends Error {},
  getAuthV2RouteRuntime: vi.fn(async () => runtimeRef.current),
}));

import { GET } from "./route";
import { AuthV2RedisBackendError } from "@/server/auth-v2/redisBackend";

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
    runtimeRef.current = undefined;
  });

  it("returns a plain first-visit 401 when no session cookie is present", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(res.headers.get("x-reef-auth-invalidated")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
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

  it("returns a stable suspended code and clears every established session cookie", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          message: "This AKB account is suspended",
          code: "account_suspended",
        }),
        { status: 403 },
      ),
    );

    const res = await GET(makeRequest(`__reef_session=${VALID_JWT}`));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "account_suspended" });
    expect(res.headers.get("x-reef-account-error")).toBe("account_suspended");
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

  it("returns a retryable 503 for an SSO Redis outage without invalidating", async () => {
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv("REEF_KEYCLOAK_ISSUER", "https://idp.test/realms/reef");
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "https://akb.test/api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.test");
    runtimeRef.current = {
      store: {
        resolve: async () => {
          throw new AuthV2RedisBackendError();
        },
      },
      close: async () => undefined,
    };

    const res = await GET(makeRequest(`__reef_auth_v2=${"H".repeat(43)}`));

    expect(res.status).toBe(502);
    expect(res.headers.get("x-reef-auth-invalidated")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns an SSO refresh-lock conflict without invalidating the session", async () => {
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv("REEF_KEYCLOAK_ISSUER", "https://idp.test/realms/reef");
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "https://akb.test/api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.test");
    const handle = "H".repeat(43);
    runtimeRef.current = {
      store: {
        resolve: async () => ({
          provider_alias: "workforce",
          subject: "subject-1",
          session_id: "sid-1",
          access_token: "access-1",
          refresh_token: "refresh-1",
          id_token: "id-1",
          issued_at: 100,
          access_token_expires_at: 110,
          refresh_token_expires_at: 200,
          absolute_expires_at: 1_000,
        }),
      },
      refreshLock: {
        acquire: async () => null,
        release: async () => undefined,
      },
      now: () => 111,
      protocolFor: () => {
        throw new Error("refresh protocol should not run without the lock");
      },
      close: async () => undefined,
    };

    const res = await GET(makeRequest(`__reef_auth_v2=${handle}`));

    expect(res.status).toBe(409);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-reef-auth-invalidated")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

function expectClearedAuthCookies(res: Response) {
  const setCookie = res.headers.get("set-cookie") ?? "";
  expect(setCookie).toContain("__reef_session=");
  expect(setCookie).toContain("__reef_auth_v2=");
  expect(setCookie).toContain("Max-Age=0");
  expect(res.headers.get("x-reef-auth-invalidated")).toBe("1");
}
