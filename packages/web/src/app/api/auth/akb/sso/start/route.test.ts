// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const SSO_START_COOKIE = "__reef_sso_start";
const NONCE_ONE = "00000000-0000-4000-8000-000000000001";
const NONCE_TWO = "00000000-0000-4000-8000-000000000002";

function makeRequest(path = "/api/auth/akb/sso/start"): Request {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

describe("GET /api/auth/akb/sso/start", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("redirects to akb Keycloak login with a nonce-bound completion redirect", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "http://backend.akb.svc.cluster.local:8000");
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NONCE_ONE);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keycloak: {
            enabled: true,
            login_url: "/api/v1/auth/keycloak/login",
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      makeRequest("/api/auth/akb/sso/start?redirect=/issues?status=open"),
    );

    expect(res.status).toBe(302);
    const location = res.headers.get("location");
    expect(location).toBeTruthy();
    const loginProxy = new URL(String(location), "http://localhost");
    expect(loginProxy.pathname).toBe("/api/auth/akb/sso/login");
    // Relative same-origin Location (REEF-137 follow-up): the browser resolves it
    // against its own origin, so the route emits no absolute host.
    expect(String(location).startsWith("/api/auth/akb/sso/login")).toBe(true);
    expect(location).not.toContain("backend.akb.svc.cluster.local");

    const callbackPath = loginProxy.searchParams.get("redirect");
    const callbackUrl = new URL(String(callbackPath), "http://localhost");
    expect(callbackUrl.pathname).toBe("/api/auth/akb/sso/callback");
    expect(callbackUrl.searchParams.get("redirect")).toBe(
      `/login/sso-complete?state=${NONCE_ONE}&next=%2Fissues%3Fstatus%3Dopen`,
    );

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SSO_START_COOKIE}=${NONCE_ONE}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Max-Age=600");
  });

  it("normalizes unsafe redirect destinations to root", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(NONCE_TWO);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keycloak: {
            enabled: true,
            login_url: "/api/v1/auth/keycloak/login",
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      makeRequest("/api/auth/akb/sso/start?redirect=https://evil.example/path"),
    );
    const loginProxy = new URL(
      String(res.headers.get("location")),
      "http://localhost",
    );

    const callbackPath = loginProxy.searchParams.get("redirect");
    const callbackUrl = new URL(String(callbackPath), "http://localhost");
    expect(callbackUrl.searchParams.get("redirect")).toBe(
      `/login/sso-complete?state=${NONCE_TWO}&next=%2F`,
    );
  });

  it("redirects back to login when SSO is disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ keycloak: { enabled: false, login_url: null } }),
        { status: 200 },
      ),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?sso_error=sso_disabled");
  });

  it("redirects back to login when backend config is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream down", { status: 503 }),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=backend_unconfigured",
    );
  });
});
