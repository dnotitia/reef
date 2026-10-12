// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthV2SessionRecord } from "./sessionStore";

const state = vi.hoisted(() => ({
  createClient: vi.fn(),
  connect: vi.fn(async () => undefined),
  quit: vi.fn(async () => undefined),
  resolve: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("redis", () => ({ createClient: state.createClient }));
vi.mock("@/lib/akb/loadAkbAuthConfig", () => ({
  loadAkbAuthConfig: state.loadConfig,
}));
vi.mock("./config", () => ({
  requireAuthV2RuntimeConfig: () => ({
    enabled: true,
    mode: "sso",
    issuer: "https://idp.test/realms/reef",
    transportUrl: "https://idp.test/realms/reef",
    clientId: "reef-web",
    audience: "https://akb.test/api",
    publicOrigin: "https://reef.test",
    redisUrl: "redis://localhost:6379",
    encryptionKey: new Uint8Array(32),
    sessionNamespace: "reef-test",
  }),
}));
vi.mock("./sessionStore", () => ({
  createAuthV2SessionStore: () => ({ resolve: state.resolve }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.createClient.mockImplementation(() => ({
    on: vi.fn(),
    connect: state.connect,
    quit: state.quit,
    destroy: vi.fn(),
    isOpen: true,
    set: vi.fn(),
    get: vi.fn(),
    getDel: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
    sAdd: vi.fn(),
    sMembers: vi.fn(),
    sRem: vi.fn(),
    expire: vi.fn(),
    ping: vi.fn(),
  }));
  state.connect.mockResolvedValue(undefined);
  state.loadConfig.mockResolvedValue({
    ok: true,
    config: {
      schema_version: 2,
      auth_mode: "sso",
      local_auth: { enabled: false },
      keycloak: { enabled: true, browser_session_ready: true },
      providers: [
        {
          provider_type: "keycloak-oidc",
          alias: "workforce",
          display_name: "SSO",
          login_url: "/login",
        },
      ],
      mcp_oauth: { enabled: false },
    },
  });
});

function record(token: string): AuthV2SessionRecord {
  const now = Math.floor(Date.now() / 1000);
  return {
    provider_alias: "workforce",
    subject: "subject",
    session_id: "sid",
    access_token: token,
    refresh_token: "refresh",
    id_token: "id",
    issued_at: now,
    access_token_expires_at: now + 600,
    refresh_token_expires_at: now + 1200,
    absolute_expires_at: now + 3600,
  };
}

describe("SSO runtime transport ownership", () => {
  it("shares one Redis connection while reading each user's current credential at every boundary", async () => {
    const handles = ["A".repeat(43), "B".repeat(43)];
    let generation = 1;
    state.resolve.mockImplementation(async (handle: string) =>
      record(`${handle[0]}-${generation}`),
    );
    const { resolveAuthV2Credential } = await import("./routeHelpers");
    const first = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        resolveAuthV2Credential(handles[index % 2]),
      ),
    );
    expect(first.slice(0, 2)).toEqual(["A-1", "B-1"]);
    generation = 2;
    expect(await Promise.all(handles.map(resolveAuthV2Credential))).toEqual([
      "A-2",
      "B-2",
    ]);
    expect(state.resolve).toHaveBeenCalledTimes(102);
    expect(state.loadConfig).toHaveBeenCalledTimes(102);
    expect(state.createClient).toHaveBeenCalledTimes(1);
    expect(state.quit).not.toHaveBeenCalled();
  });

  it("retries transport initialization after a failed connection without poisoning later requests", async () => {
    state.connect.mockRejectedValueOnce(new Error("connection failed"));
    const { getAuthV2RouteRuntime } = await import("./runtime");
    await expect(getAuthV2RouteRuntime()).rejects.toMatchObject({
      code: "auth_v2_runtime_unavailable",
    });
    await expect(getAuthV2RouteRuntime()).resolves.toHaveProperty("store");
    expect(state.createClient).toHaveBeenCalledTimes(2);
  });
});
