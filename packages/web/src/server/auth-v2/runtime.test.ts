// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  readAuthV2RuntimeConfig: () => ({ mode: "sso" }),
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
  vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ ok: true })),
  );
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
  it("shares auth configuration within each request while resolving the current session at every AKB boundary", async () => {
    const handles = ["A".repeat(43), "B".repeat(43)];
    let generation = 1;
    state.resolve.mockImplementation(async (handle: string) =>
      record(`${handle[0]}-${generation}`),
    );
    const requests = handles.map(
      (handle) =>
        new Request("https://reef.test/api/my-work", {
          headers: { cookie: `__reef_auth_v2=${handle}` },
        }),
    );
    const { getAkbAdapter } = await import("@/lib/api/requestHelpers");
    const requestAdapter = (request: Request) => {
      const result = getAkbAdapter(request);
      if ("response" in result)
        throw new Error("Expected an authenticated adapter");
      return result.adapter;
    };
    const adapters = requests.map(requestAdapter);
    const first = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        adapters[index % 2].request("/api/v1/auth/me"),
      ),
    );
    expect(first.slice(0, 2)).toEqual([{ ok: true }, { ok: true }]);
    generation = 2;
    await Promise.all(
      requests.map((request) =>
        requestAdapter(request).request("/api/v1/auth/me"),
      ),
    );
    expect(state.resolve).toHaveBeenCalledTimes(102);
    expect(state.loadConfig).toHaveBeenCalledTimes(2);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls[100]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer A-2",
    });
    expect(fetchMock.mock.calls[101]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer B-2",
    });
    const nextRequest = new Request("https://reef.test/api/my-work", {
      headers: { cookie: `__reef_auth_v2=${handles[0]}` },
    });
    await requestAdapter(nextRequest).request("/api/v1/auth/me");
    expect(state.loadConfig).toHaveBeenCalledTimes(3);
    state.resolve.mockResolvedValue(null);
    await expect(adapters[0].request("/api/v1/auth/me")).rejects.toMatchObject({
      context: { status: 401 },
    });
    expect(state.loadConfig).toHaveBeenCalledTimes(3);
    expect(state.createClient).toHaveBeenCalledTimes(1);
    expect(state.quit).not.toHaveBeenCalled();
  });

  it("retries transport initialization after a failed connection without poisoning later requests", async () => {
    state.connect.mockRejectedValueOnce(new Error("connection failed"));
    const { getAuthV2RouteRuntime } = await import("./runtime");
    await expect(
      getAuthV2RouteRuntime(new Request("https://reef.test")),
    ).rejects.toMatchObject({
      code: "auth_v2_runtime_unavailable",
    });
    await expect(
      getAuthV2RouteRuntime(new Request("https://reef.test")),
    ).resolves.toHaveProperty("store");
    expect(state.createClient).toHaveBeenCalledTimes(2);
  });
});
