// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAkbAuthConfig } from "./loadAkbAuthConfig";

describe("loadAkbAuthConfig", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps a legacy delegated SSO catalog unavailable in local mode", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keycloak: { enabled: true, login_url: "/api/v1/auth/keycloak/login" },
        }),
        { status: 200 },
      ),
    );

    const result = await loadAkbAuthConfig();

    expect(result).toEqual({
      ok: true,
      config: {
        local_auth: { enabled: true },
        keycloak: {
          enabled: false,
          login_url: null,
          sso_only: false,
        },
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/config",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reports backend_unconfigured when AKB_BACKEND_URL is missing", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await loadAkbAuthConfig();

    expect(result).toEqual({ ok: false, reason: "backend_unconfigured" });
    // Fail safe before any network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports backend_rejected when akb rejects the config request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream down", { status: 503 }),
    );

    const result = await loadAkbAuthConfig();

    expect(result).toEqual({ ok: false, reason: "backend_rejected" });
  });

  it("projects only enabled SSO catalog aliases onto Reef-owned start paths", async () => {
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
        schema_version: 2,
        auth_mode: "sso",
        local_auth: { enabled: true },
        keycloak: { enabled: true, browser_session_ready: true },
        providers: [
          {
            provider_type: "keycloak-oidc",
            alias: "workforce",
            display_name: "Company SSO",
            login_url: "/api/v1/auth/sso/workforce/login",
          },
          {
            provider_type: "keycloak-oidc",
            alias: "disabled",
            display_name: "Disabled provider",
            login_url: null,
          },
        ],
      }),
    );

    const result = await loadAkbAuthConfig();

    expect(result).toMatchObject({
      ok: true,
      config: {
        local_auth: { enabled: false },
        providers: [
          {
            alias: "workforce",
            login_url: "/api/auth/akb/sso/start?provider=workforce",
          },
        ],
      },
    });
  });

  it("projects the legacy single-provider catalog onto Reef-owned OIDC", async () => {
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv(
      "REEF_KEYCLOAK_ISSUER",
      "https://identity.example.com/realms/reef",
    );
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
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

    await expect(loadAkbAuthConfig()).resolves.toEqual({
      ok: true,
      config: {
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
      },
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/config",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy.mock.calls.flat().join(" ")).not.toContain(
      "/auth/keycloak/login",
    );
    expect(fetchSpy.mock.calls.flat().join(" ")).not.toContain(
      "/auth/keycloak/exchange",
    );
  });

  it.each([
    ["disabled Keycloak", { enabled: false, login_url: null }],
    [
      "non-canonical login path",
      {
        enabled: true,
        login_url: "/api/v1/auth/keycloak/login?redirect=https://evil.test",
      },
    ],
  ])(
    "fails closed for an unsafe legacy SSO catalog (%s)",
    async (_label, keycloak) => {
      vi.stubEnv("REEF_AUTH_MODE", "sso");
      vi.stubEnv(
        "REEF_KEYCLOAK_ISSUER",
        "https://identity.example.com/realms/reef",
      );
      vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
      vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
      vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        Response.json({ local_auth: { enabled: false }, keycloak }),
      );

      await expect(loadAkbAuthConfig()).resolves.toEqual({
        ok: false,
        reason: "mode_mismatch",
      });
    },
  );

  it("preserves v2 mode mismatch checks", async () => {
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
        schema_version: 2,
        auth_mode: "local",
        local_auth: { enabled: true },
        keycloak: { enabled: false, browser_session_ready: false },
        providers: [],
      }),
    );

    await expect(loadAkbAuthConfig()).resolves.toEqual({
      ok: false,
      reason: "mode_mismatch",
    });
  });

  it("fails closed when the SSO provider catalog is not browser-ready", async () => {
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
        schema_version: 2,
        auth_mode: "sso",
        local_auth: { enabled: false },
        keycloak: { enabled: true, browser_session_ready: false },
        providers: [],
      }),
    );

    await expect(loadAkbAuthConfig()).resolves.toEqual({
      ok: false,
      reason: "mode_mismatch",
    });
  });
});
