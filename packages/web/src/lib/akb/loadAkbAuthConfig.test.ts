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

  it("returns the parsed Keycloak config on success", async () => {
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
          enabled: true,
          login_url: "/api/v1/auth/keycloak/login",
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
});
