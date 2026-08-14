// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const TOKEN_MARKERS = ["access-token", "refresh-token", "id-token"];

function makeRequest(path = "/api/auth/akb/sso/start"): Request {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

function versionedCatalog() {
  return {
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
  };
}

describe("GET /api/auth/akb/sso/start", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv(
      "REEF_KEYCLOAK_ISSUER",
      "https://identity.example.com/realms/reef",
    );
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("starts Reef-owned PKCE with only a catalog-validated provider hint", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(versionedCatalog()));

    const response = await GET(
      makeRequest(
        "/api/auth/akb/sso/start?provider=workforce&redirect=/issues?status=open",
      ),
    );

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(
      "https://identity.example.com/realms/reef/protocol/openid-connect/auth",
    );
    expect(location.searchParams.get("client_id")).toBe("reef-web");
    expect(location.searchParams.get("kc_idp_hint")).toBe("workforce");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/__reef_sso_start=[A-Za-z0-9_-]{43}/);
    expect(cookie).toContain("HttpOnly");
    for (const marker of TOKEN_MARKERS) {
      expect(`${location}${cookie}`).not.toContain(marker);
    }
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/v1/auth/config",
    );
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain(
      "/auth/keycloak/login",
    );
  });

  it("rejects an alias absent from AKB's enabled catalog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(versionedCatalog()),
    );

    const response = await GET(
      makeRequest("/api/auth/akb/sso/start?provider=attacker-supplied"),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/login?sso_error=provider_unavailable",
    );
  });

  it("normalizes unsafe post-login navigation and never calls retired AKB auth", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(versionedCatalog()));

    const response = await GET(
      makeRequest(
        "/api/auth/akb/sso/start?provider=workforce&redirect=https://evil.example",
      ),
    );

    expect(response.status).toBe(302);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls.flat().join(" ")).not.toContain(
      "/auth/keycloak/exchange",
    );
  });

  it("fails closed when Reef and AKB modes disagree", async () => {
    vi.stubEnv("REEF_AUTH_MODE", "local");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json(versionedCatalog()));

    const response = await GET(makeRequest("/api/auth/akb/sso/start"));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/login?sso_error=mode_mismatch",
    );
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
