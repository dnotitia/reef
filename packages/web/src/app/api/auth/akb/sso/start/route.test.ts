import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeRef = vi.hoisted(() => ({
  current: undefined as
    | {
        contract: {
          auth_mode: "sso";
          providers: Array<{
            alias: string;
            provider_type: "keycloak-oidc" | "local-realm";
            display_name: string;
            login_url: string | null;
          }>;
        };
        protocolFor: () => {
          beginAuthorization: (input: unknown) => Promise<{
            location: string;
            state: string;
            browserBinding: string;
          }>;
        };
        close: () => Promise<void>;
      }
    | undefined,
}));

vi.mock("@/server/auth-v2/runtime", () => ({
  AuthV2RouteRuntimeError: class AuthV2RouteRuntimeError extends Error {},
  getAuthV2RouteRuntime: vi.fn(async () => {
    if (!runtimeRef.current) throw new Error("runtime missing");
    return runtimeRef.current;
  }),
}));

import { GET } from "./route";

describe("SSO start route", () => {
  beforeEach(() => {
    runtimeRef.current = {
      contract: {
        auth_mode: "sso",
        providers: [
          {
            alias: "workforce",
            provider_type: "keycloak-oidc",
            display_name: "Company SSO",
            login_url: "/api/v1/auth/sso/workforce/login",
          },
          {
            alias: "local-realm",
            provider_type: "local-realm",
            display_name: "Local realm",
            login_url: "/api/v1/auth/sso/local-realm/login",
          },
        ],
      },
      protocolFor: () => ({
        beginAuthorization: vi.fn(async () => ({
          location: "https://idp.test/authorize?state=opaque",
          state: "opaque",
          browserBinding: "A".repeat(43),
        })),
      }),
      close: vi.fn(async () => undefined),
    };
  });

  it("starts the selected provider with a safe redirect", async () => {
    const response = await GET(
      new Request(
        "https://reef.test/api/auth/akb/sso/start?provider=workforce&redirect=%2Fissues",
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://idp.test/authorize?state=opaque",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "__reef_auth_v2_state=workforce.",
    );
  });

  it("requires an explicit provider when several are available", async () => {
    const response = await GET(
      new Request("https://reef.test/api/auth/akb/sso/start"),
    );
    expect(response.headers.get("location")).toBe(
      "/login?sso_error=provider_required",
    );
  });

  it("selects the only available provider without a provider query", async () => {
    if (!runtimeRef.current) throw new Error("runtime missing");
    runtimeRef.current.contract.providers =
      runtimeRef.current.contract.providers.slice(0, 1);
    const response = await GET(
      new Request(
        "https://reef.test/api/auth/akb/sso/start?redirect=%2Fissues",
      ),
    );
    expect(response.status).toBe(302);
  });
});
