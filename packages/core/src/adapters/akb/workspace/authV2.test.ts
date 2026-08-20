// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { AkbApiError, AuthError } from "../../../errors";
import { setupFetch } from "../../../test-support/akb/fetchMock";
import { mockOpenTelemetry } from "../../../test-support/akb/otelMock";
import {
  AkbAuthV2ConfigSchema,
  AKB_AUTH_V2_CONFIG_PATH,
  getAuthV2Config,
  validateAuthV2Account,
} from "./authV2";

mockOpenTelemetry();

const BASE_URL = "https://akb.test";
const USER = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  display_name: "Alice",
  is_admin: false,
};

function validSsoConfig() {
  return {
    schema_version: 2,
    auth_mode: "sso",
    local_auth: { enabled: true },
    canonical_issuer: "https://identity.example.com/realms/reef",
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
        provider_type: "keycloak-oidc",
        alias: "workforce",
        display_name: "Company SSO",
      },
    ],
  } as const;
}

describe("AKB auth-v2 contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the strict versioned provider catalog", () => {
    expect(AkbAuthV2ConfigSchema.parse(validSsoConfig())).toEqual(
      validSsoConfig(),
    );
  });

  it("rejects the deployed legacy config instead of projecting it", () => {
    const legacy = {
      local_auth: { enabled: true },
      keycloak: {
        enabled: true,
        login_url: "/api/v1/auth/keycloak/login",
      },
    };
    expect(() => AkbAuthV2ConfigSchema.parse(legacy)).toThrow();
  });

  it.each([
    ["missing canonical issuer", { canonical_issuer: undefined }],
    ["wrong algorithm", { token_validation: { algorithms: ["HS256"] } }],
    [
      "wrong account endpoint",
      {
        account_validation: {
          endpoint: "/api/v1/auth/me",
          credential: "bearer_access_token",
          requires_subject_binding: true,
          denial_codes: [
            "membership_required",
            "account_suspended",
            "identity_conflict",
          ],
        },
      },
    ],
  ])("rejects %s", (_label, override) => {
    const value = { ...validSsoConfig(), ...override };
    expect(() => AkbAuthV2ConfigSchema.parse(value)).toThrow();
  });

  it("requires an explicit empty OIDC contract for local mode", () => {
    const local = {
      schema_version: 2,
      auth_mode: "local",
      local_auth: { enabled: true },
      keycloak: { enabled: false, browser_session_ready: false },
    };
    expect(AkbAuthV2ConfigSchema.parse(local)).toEqual(local);
  });

  it("does not force SSO-only policy fields onto local mode", () => {
    const local = {
      schema_version: 2,
      auth_mode: "local",
      local_auth: { enabled: true },
      keycloak: { enabled: false, browser_session_ready: false },
      token_validation: {
        algorithms: ["RS256"],
        access_token_type: "Bearer",
        provider_claim: "identity_provider",
      },
    };
    expect(() => AkbAuthV2ConfigSchema.parse(local)).toThrow();
  });

  it("fetches only the v2 config endpoint", async () => {
    const { calls } = setupFetch([{ body: validSsoConfig() }]);
    await getAuthV2Config({ baseUrl: `${BASE_URL}/` });
    expect(calls[0]?.url).toBe(`${BASE_URL}${AKB_AUTH_V2_CONFIG_PATH}`);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.redirect).toBe("manual");
  });

  it("reports a contract mismatch as a bounded upstream error", async () => {
    setupFetch([{ body: { keycloak: { enabled: true } } }]);
    await expect(getAuthV2Config({ baseUrl: BASE_URL })).rejects.toMatchObject({
      name: "AkbApiError",
      status: 502,
    });
  });

  it("validates a principal only through the v2 account endpoint", async () => {
    const { calls } = setupFetch([{ body: { user: USER } }]);
    const result = await validateAuthV2Account({
      baseUrl: BASE_URL,
      accessToken: "keycloak-access-token",
      providerAlias: "workforce",
      subject: "kc-subject-1",
    });

    expect(result).toEqual({ user: USER });
    expect(calls[0]?.url).toBe(`${BASE_URL}/api/v2/auth/account-validation`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.redirect).toBe("manual");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer keycloak-access-token",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      provider_alias: "workforce",
      subject: "kc-subject-1",
    });
  });

  it("maps stable account denials to AuthError without leaking tokens", async () => {
    setupFetch([
      {
        status: 403,
        body: {
          code: "membership_required",
          message: "not a member",
        },
      },
    ]);
    const error = await validateAuthV2Account({
      baseUrl: BASE_URL,
      accessToken: "secret-access-token",
      providerAlias: "workforce",
      subject: "kc-subject-1",
    }).catch((value) => value);

    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({
      context: { origin: "akb", code: "membership_required", status: 403 },
    });
    expect(String(error)).not.toContain("secret-access-token");
  });

  it("rejects malformed account projections without returning upstream data", async () => {
    setupFetch([{ body: { token: "not-a-user" } }]);
    await expect(
      validateAuthV2Account({
        baseUrl: BASE_URL,
        accessToken: "access-token",
        providerAlias: "workforce",
        subject: "kc-subject-1",
      }),
    ).rejects.toMatchObject({
      name: "AkbApiError",
      status: 502,
    });
  });

  it("rejects invalid caller input before sending a bearer token", async () => {
    const { calls } = setupFetch([]);
    await expect(
      validateAuthV2Account({
        baseUrl: BASE_URL,
        accessToken: "",
        providerAlias: "workforce",
        subject: "kc-subject-1",
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
    expect(calls).toHaveLength(0);
  });

  it("bounds opaque account-validation credentials before constructing a request", async () => {
    const { calls } = setupFetch([]);
    await expect(
      validateAuthV2Account({
        baseUrl: BASE_URL,
        accessToken: "a".repeat(512 * 1024 + 1),
        providerAlias: "workforce",
        subject: "kc-subject-1",
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
    await expect(
      validateAuthV2Account({
        baseUrl: BASE_URL,
        accessToken: "access-token",
        providerAlias: "workforce",
        subject: "kc\nsubject",
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
    expect(calls).toHaveLength(0);
  });
});
