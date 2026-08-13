// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRuntime: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/server/auth/runtime", () => ({
  getSsoAuthRuntime: mocks.getRuntime,
}));

import { POST } from "./route";

const OPAQUE_HANDLE = Buffer.alloc(32, 7).toString("base64url");
const TOKEN_MARKERS = [
  "access-token-material",
  "refresh-token-material",
  "id-token-material",
  "id_token_hint",
];

function makeRequest(cookie?: string): Request {
  return new Request("https://reef.example.com/api/auth/akb/logout", {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
}

function configureSso(): void {
  vi.stubEnv("REEF_AUTH_MODE", "sso");
  vi.stubEnv(
    "REEF_KEYCLOAK_ISSUER",
    "https://identity.example.com/realms/reef",
  );
  vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
  vi.stubEnv("REEF_AKB_API_AUDIENCE", "akb-api");
  vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef.example.com");
}

describe("POST /api/auth/akb/logout", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "local");
    mocks.logout.mockResolvedValue(
      "https://identity.example.com/realms/reef/protocol/openid-connect/logout",
    );
    mocks.getRuntime.mockResolvedValue({ sessions: { logout: mocks.logout } });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps local logout stateless and clears the AKB JWT cookie", async () => {
    const response = await POST(makeRequest("__reef_session=local-jwt"));

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("__reef_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });

  it("deletes the opaque SSO session and returns only same-origin navigation", async () => {
    configureSso();

    const response = await POST(
      makeRequest(
        `__reef_session=${OPAQUE_HANDLE}; __reef_sso_id_token=id-token-material`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.logout).toHaveBeenCalledWith(OPAQUE_HANDLE);
    const body = await response.json();
    expect(body).toEqual({
      redirectUrl: "/api/auth/akb/sso/logout",
    });
    const exposed = `${response.headers.get("set-cookie") ?? ""} ${JSON.stringify(body)}`;
    for (const token of TOKEN_MARKERS) expect(exposed).not.toContain(token);
    expect(exposed).toContain("Max-Age=0");
  });

  it("still clears the browser carrier if revocation or storage fails", async () => {
    configureSso();
    mocks.logout.mockRejectedValue(
      new Error("refresh-token-material appeared upstream"),
    );

    const response = await POST(makeRequest(`__reef_session=${OPAQUE_HANDLE}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      redirectUrl: "/api/auth/akb/sso/logout",
    });
    expect(response.headers.get("set-cookie")).not.toContain(
      "refresh-token-material",
    );
  });
});
