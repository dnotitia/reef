// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function makeRequest(cookie?: string): Request {
  return new Request("http://localhost/api/auth/akb/config", {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
  });
}

describe("GET /api/auth/akb/config", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns public Keycloak config without requiring a session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema_version: 2,
          auth_mode: "sso",
          local_auth: { enabled: false },
          keycloak: { enabled: true, browser_session_ready: true },
          providers: [
            {
              provider_type: "keycloak-oidc",
              alias: "workforce",
              display_name: "Company SSO",
              login_url: "/api/v1/auth/sso/workforce/login",
            },
          ],
          mcp_oauth: { enabled: false },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schema_version: 2,
      auth_mode: "sso",
      local_auth: { enabled: false },
      keycloak: { enabled: true, browser_session_ready: true },
      providers: [
        {
          provider_type: "keycloak-oidc",
          alias: "workforce",
          display_name: "Company SSO",
          login_url: "/api/v1/auth/sso/workforce/login",
        },
      ],
      mcp_oauth: { enabled: false },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/config",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("consumes a callback invalidation marker into the browser cleanup contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema_version: 2,
          auth_mode: "sso",
          local_auth: { enabled: false },
          keycloak: { enabled: true, browser_session_ready: true },
          providers: [],
          mcp_oauth: { enabled: false },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(makeRequest("__reef_auth_invalidated=1"));

    expect(res.status).toBe(200);
    expect(res.headers.get("x-reef-auth-invalidated")).toBe("1");
    expect(res.headers.get("set-cookie")).toContain("__reef_auth_invalidated=");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("returns 503 when AKB_BACKEND_URL is missing", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "");

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
  });

  it("returns 502 when akb config fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream down", { status: 503 }),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
  });
});
