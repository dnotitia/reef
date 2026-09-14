import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeRef = vi.hoisted(() => ({
  current: undefined as Record<string, unknown> | undefined,
  issue: undefined as ReturnType<typeof vi.fn> | undefined,
}));

vi.mock("@/server/auth-v2/runtime", () => ({
  AuthV2RouteRuntimeError: class AuthV2RouteRuntimeError extends Error {},
  getAuthV2RouteRuntime: vi.fn(async () => runtimeRef.current),
}));

import { buildAuthV2StateCookie } from "@/server/auth-v2/cookie";
import { GET } from "./route";

const binding = "A".repeat(43);

function setup(completeAuthorization: () => Promise<unknown>) {
  const issue = vi.fn(async () => ({
    handle: "H".repeat(43),
    expiresAt: 2_000_000 + 86_400,
  }));
  runtimeRef.issue = issue;
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
      ],
    },
    protocolFor: () => ({ completeAuthorization }),
    stateStore: {},
    store: { issue },
    now: () => 2_000_000,
    close: vi.fn(async () => undefined),
  };
}
describe("SSO callback route", () => {
  beforeEach(() => {
    setup(async () => ({
      providerAlias: "workforce",
      redirectPath: "/workspace/reef",
      subject: "subject-1",
      sessionId: "sid-1",
      tokenSet: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        idToken: "id-token",
        accessTokenExpiresAt: 2_000_060,
        refreshTokenExpiresAt: 2_000_600,
      },
      account: { id: "u-1", username: "alice" },
    }));
  });

  it("turns a verified code into an opaque session cookie", async () => {
    const response = await GET(
      new Request(
        "https://reef.test/api/auth/akb/sso/callback?code=code&state=state",
        {
          headers: {
            cookie: buildAuthV2StateCookie("workforce", binding),
          },
        },
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/workspace/reef");
    expect(response.headers.get("set-cookie")).toContain(
      "__reef_auth_v2=HHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
    );
    expect(response.headers.get("set-cookie")).not.toContain("access-token");
    expect(runtimeRef.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        refresh_token_expires_at: 2_000_600,
        absolute_expires_at: 2_000_000 + 86_400,
      }),
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=86400");
  });

  it("clears auth state on account denial", async () => {
    setup(async () => {
      const error = new Error("denied");
      error.name = "AccountValidationError";
      Object.assign(error, { code: "membership_required" });
      throw error;
    });
    const response = await GET(
      new Request(
        "https://reef.test/api/auth/akb/sso/callback?code=code&state=state",
        {
          headers: {
            cookie: buildAuthV2StateCookie("workforce", binding),
          },
        },
      ),
    );
    expect(response.headers.get("location")).toBe(
      "/login?sso_error=membership_required",
    );
    expect(response.headers.get("x-reef-auth-invalidated")).toBe("1");
  });
});
