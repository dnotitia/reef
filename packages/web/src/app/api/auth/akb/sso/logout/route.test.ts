import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAuthV2LogoutCookie } from "@/server/auth-v2/cookie";
import { GET } from "./route";

describe("SSO logout continuation", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("creates tokenless provider logout using the trusted runtime issuer", async () => {
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv("REEF_KEYCLOAK_ISSUER", "https://idp.test/realms/reef");
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "https://akb.test/api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.test");
    vi.stubEnv("REEF_SESSION_REDIS_URL", "redis://localhost:6379");
    vi.stubEnv(
      "REEF_SESSION_ENCRYPTION_KEY",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    );
    vi.stubEnv("REEF_AUTH_SESSION_NAMESPACE", "test");
    const nonce = "logout-nonce";
    const response = await GET(
      new Request(`https://reef.test/api/auth/akb/sso/logout?nonce=${nonce}`, {
        headers: { cookie: buildAuthV2LogoutCookie(nonce) },
      }),
    );
    expect(response.status).toBe(302);
    const location = new URL(String(response.headers.get("location")));
    expect(location.origin).toBe("https://idp.test");
    expect(location.pathname).toBe(
      "/realms/reef/protocol/openid-connect/logout",
    );
    expect(location.searchParams.get("client_id")).toBe("reef-web");
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(
      "https://reef.test/login",
    );
  });

  it("rejects a missing or mismatched one-time nonce", async () => {
    const response = await GET(
      new Request("https://reef.test/api/auth/akb/sso/logout?nonce=wrong"),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a cross-origin logout POST before touching Redis", async () => {
    vi.stubEnv("REEF_AUTH_MODE", "sso");
    vi.stubEnv("REEF_KEYCLOAK_ISSUER", "https://idp.test/realms/reef");
    vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
    vi.stubEnv("REEF_AKB_API_AUDIENCE", "https://akb.test/api");
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.test");
    vi.stubEnv("REEF_SESSION_REDIS_URL", "redis://localhost:6379");
    vi.stubEnv(
      "REEF_SESSION_ENCRYPTION_KEY",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    );
    vi.stubEnv("REEF_AUTH_SESSION_NAMESPACE", "test");
    const response = await (
      await import("@/app/api/auth/akb/logout/route")
    ).POST(
      new Request("https://reef.test/api/auth/akb/logout", {
        method: "POST",
        headers: { origin: "https://evil.test" },
      }),
    );
    expect(response.status).toBe(403);
  });
});
