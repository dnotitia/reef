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

  it("does not advertise legacy delegated SSO while Reef is in local mode", async () => {
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

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      local_auth: { enabled: true },
      keycloak: {
        enabled: false,
        login_url: null,
        sso_only: false,
      },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/config",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("projects the legacy AKB catalog onto Reef-owned SSO paths", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv(
      "REEF_KEYCLOAK_ISSUER",
      "https://identity.example.com/realms/reef",
    );
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        local_auth: { enabled: false },
        keycloak: {
          enabled: true,
          login_url: "/api/v1/auth/keycloak/login",
          sso_only: true,
          enrollment_mode: "invite_only",
        },
      }),
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
          alias: "legacy",
          display_name: "SSO",
          login_url: "/api/auth/akb/sso/start?provider=legacy",
        },
      ],
    });
  });

  it("keeps the legacy password capability in the SSO projection", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv(
      "REEF_KEYCLOAK_ISSUER",
      "https://identity.example.com/realms/reef",
    );
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        local_auth: { enabled: true },
        keycloak: {
          enabled: true,
          login_url: "/api/v1/auth/keycloak/login",
          sso_only: false,
        },
      }),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).local_auth).toEqual({ enabled: true });
  });

  it("consumes a callback invalidation marker into the browser cleanup contract", async () => {
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
