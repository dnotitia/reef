// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  logoutLocation: vi.fn(),
}));

vi.mock("@/server/auth/runtime", () => ({
  getSsoAuthRuntime: mocks.getRuntime,
}));

import { GET } from "./route";

const TOKEN_MARKERS = [
  "access-token-material",
  "refresh-token-material",
  "id-token-material",
  "id_token_hint",
];
const EXPECTED_LOGOUT_LOCATION =
  "https://identity.example.com/realms/reef/protocol/openid-connect/logout?client_id=reef-web&post_logout_redirect_uri=https%3A%2F%2Freef.example.com%2Flogin";

describe("GET /api/auth/akb/sso/logout", () => {
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
    mocks.logoutLocation.mockReturnValue(
      "https://identity.example.com/realms/reef/protocol/openid-connect/logout?client_id=reef-web&post_logout_redirect_uri=https%3A%2F%2Freef.example.com%2Flogin",
    );
    mocks.getRuntime.mockResolvedValue({
      oidc: { logoutLocation: mocks.logoutLocation },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns only issuer-derived navigation without mutating browser state", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await GET();

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toBe(EXPECTED_LOGOUT_LOCATION);
    expect(new URL(location).pathname).toBe(
      "/realms/reef/protocol/openid-connect/logout",
    );
    const exposed = `${location} ${response.headers.get("set-cookie") ?? ""}`;
    for (const token of TOKEN_MARKERS) expect(exposed).not.toContain(token);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });

  it("is unavailable outside SSO mode", async () => {
    vi.stubEnv("REEF_AUTH_MODE", "local");

    const response = await GET();

    expect(response.status).toBe(404);
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });

  it("falls back to a same-origin login path without exposing an upstream error", async () => {
    vi.stubEnv("REEF_KEYCLOAK_ISSUER", "refresh-token-material");

    const response = await GET();

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login");
    expect(JSON.stringify([...response.headers])).not.toContain(
      "refresh-token-material",
    );
  });
});
