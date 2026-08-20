// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAkbAuthV2Config } from "./loadAkbAuthV2Config";

const VALID_CONFIG = {
  schema_version: 2,
  auth_mode: "sso",
  local_auth: { enabled: true },
  canonical_issuer: "https://keycloak.test/realms/reef",
  accepted_audiences: ["akb-api"],
  accepted_clients: ["reef-web"],
  token_validation: {
    algorithms: ["RS256"],
    access_token_type: "Bearer",
    provider_claim: "identity_provider",
  },
  account_validation: {
    endpoint: "/api/v2/auth/account-validation",
    credential: "bearer_access_token",
    requires_subject_binding: true,
    denial_codes: [
      "membership_required",
      "account_suspended",
      "identity_conflict",
    ],
  },
  keycloak: { enabled: true, browser_session_ready: true },
  providers: [
    {
      alias: "keycloak",
      display_name: "Workspace SSO",
      provider_type: "keycloak-oidc",
    },
  ],
};

describe("loadAkbAuthV2Config", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("loads only the explicit v2 catalog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(VALID_CONFIG), { status: 200 }),
    );

    const result = await loadAkbAuthV2Config();

    expect(result).toEqual({ ok: true, config: VALID_CONFIG });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://akb.test/api/v2/auth/config",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
  });

  it("rejects a legacy config as a contract mismatch without projection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          local_auth: { enabled: true },
          keycloak: {
            enabled: true,
            login_url: "/api/v1/auth/keycloak/login",
          },
        }),
        { status: 200 },
      ),
    );

    await expect(loadAkbAuthV2Config()).resolves.toEqual({
      ok: false,
      reason: "contract_mismatch",
    });
  });

  it("reports contract_unavailable when AKB is unconfigured or unavailable", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "");
    await expect(loadAkbAuthV2Config()).resolves.toEqual({
      ok: false,
      reason: "contract_unavailable",
    });

    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("down", { status: 503 }),
    );
    await expect(loadAkbAuthV2Config()).resolves.toEqual({
      ok: false,
      reason: "contract_unavailable",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("upstream gateway failed", { status: 502 }),
      ),
    );
    await expect(loadAkbAuthV2Config()).resolves.toEqual({
      ok: false,
      reason: "contract_unavailable",
    });
  });
});
