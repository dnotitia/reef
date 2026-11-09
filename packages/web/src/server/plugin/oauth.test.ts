// @vitest-environment node
import { createHash } from "node:crypto";
import { akbListVaults } from "@reef/core";
import { afterEach, expect, it, vi } from "vitest";
import {
  authenticateMcp,
  authorize,
  mcpAuthError,
  registerClient,
} from "./oauth";
import { readAuthV2RuntimeConfig } from "@/server/auth-v2/config";
import {
  createPluginOAuthStore,
  opaqueValue,
  PLUGIN_SCOPE,
} from "./oauthStore";
import { createOAuthBrowserState, nowSeconds } from "./oauthBrowserState";

const mocks = vi.hoisted(() => ({
  getRedis: vi.fn(),
  getRuntime: vi.fn(),
  resolveCredential: vi.fn(),
}));
vi.mock("@/server/auth-v2/redisRuntime", () => ({
  getProcessAuthV2Redis: mocks.getRedis,
}));
vi.mock("@/server/auth-v2/runtime", () => ({
  getAuthV2RouteRuntime: mocks.getRuntime,
}));
vi.mock("@/server/auth-v2/routeHelpers", () => ({
  resolveAuthV2Credential: mocks.resolveCredential,
}));

const origin = "https://reef.test";
const callback = "http://127.0.0.1:48123/callback/native";

function config() {
  const env = {
    NODE_ENV: "test",
    REEF_AUTH_MODE: "sso",
    REEF_PUBLIC_ORIGIN: origin,
    REEF_KEYCLOAK_ISSUER: "https://identity.test/realms/reef",
    REEF_KEYCLOAK_CLIENT_ID: "reef-web",
    REEF_AKB_API_AUDIENCE: "reef",
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const config = readAuthV2RuntimeConfig(env);
  if (!config.enabled) throw new Error("Expected SSO");
  return config;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetAllMocks();
});

function registration(redirect: string) {
  return registerClient(
    new Request(`${origin}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirect],
        application_type: "native",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
  );
}

it.each([
  "https://external.test/callback/native",
  "http://localhost:48123/callback/native",
  `${callback}?next=https://external.test`,
  "http://127.0.0.1:48123@external.test/callback/native",
  "http://127.0.0.1:48123/callback/native/../other",
])(
  "rejects unsupported callbacks at the registration boundary (%s)",
  async (redirect) => {
    config();
    const response = await registration(redirect);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_client_metadata" });
  },
);

it("validates signed registration and seals anonymous consent without Redis or AKB", async () => {
  config();
  mocks.getRedis.mockRejectedValue(new Error("Redis unavailable"));
  mocks.getRuntime.mockRejectedValue(new Error("AKB unavailable"));
  const registered = await registration(callback);
  expect(registered.status).toBe(201);
  const { client_id } = await registered.json();
  const url = new URL(`${origin}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id,
    redirect_uri: callback,
    resource: `${origin}/mcp`,
    response_type: "code",
    state: "fixture-state",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256")
      .update("v".repeat(43))
      .digest("base64url"),
  }).toString();

  const authorized = await authorize(new Request(url));
  expect(authorized.status).toBe(303);
  expect(authorized.headers.get("Set-Cookie")).toMatch(
    /HttpOnly; SameSite=Lax; Max-Age=300; Secure/u,
  );
  expect(authorized.headers.get("Location")).toMatch(
    /^\/oauth\/consent\?transaction=[\w-]{43}$/u,
  );
  url.searchParams.set("redirect_uri", `${callback}-other`);
  expect((await authorize(new Request(url))).status).toBe(400);
  expect(mocks.getRedis).not.toHaveBeenCalled();
  expect(mocks.getRuntime).not.toHaveBeenCalled();
});

async function grantRequest(ttl: number) {
  const settings = config();
  const saved = new Map<string, string>();
  const redis = {
    backend: {
      async set(key: string, value: string) {
        saved.set(key, value);
      },
      async get(key: string) {
        return saved.get(key) ?? null;
      },
      async consume() {
        return null;
      },
      async del() {},
      async replace() {
        return false;
      },
    },
    async claim() {
      return true;
    },
  };
  mocks.getRedis.mockResolvedValue(redis);
  mocks.getRuntime.mockResolvedValue({ now: nowSeconds });
  const resource = `${origin}/mcp`;
  const handle = opaqueValue();
  const token = await createPluginOAuthStore(
    settings,
    redis,
    nowSeconds,
  ).grants.issue(
    {
      clientId: createOAuthBrowserState(settings).register(callback),
      resource,
      scope: PLUGIN_SCOPE,
      session: { handle, deadline: nowSeconds() + 60 },
    },
    ttl,
  );
  return {
    handle,
    request: new Request(resource, {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: "__reef_auth_v2=fixture",
      },
    }),
  };
}

it("rejects an expired opaque grant with discovery and does not touch browser cookies", async () => {
  vi.useFakeTimers();
  const { request } = await grantRequest(1);
  vi.advanceTimersByTime(1_000);
  const response = await authenticateMcp(request).catch(mcpAuthError);
  if (!(response instanceof Response))
    throw new Error("Expired grant authenticated");
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toContain(
    'error="invalid_token"',
  );
  expect(response.headers.has("Set-Cookie")).toBe(false);
  expect(mocks.resolveCredential).not.toHaveBeenCalled();
});

it("uses the rotated AKB bearer after verifying the account on the same adapter", async () => {
  const { request, handle } = await grantRequest(60);
  vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
  mocks.resolveCredential
    .mockResolvedValueOnce("fixture-initial-access")
    .mockResolvedValueOnce("fixture-rotated-access");
  const fetchAkb = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ username: "alice", is_admin: false }),
    )
    .mockResolvedValueOnce(Response.json({ vaults: [] }));
  vi.stubGlobal("fetch", fetchAkb);

  const adapter = await authenticateMcp(request);
  expect(await akbListVaults({ adapter })).toEqual({ vaults: [] });

  expect(
    fetchAkb.mock.calls.map(([url, init]) => [
      String(url),
      new Headers(init?.headers).get("Authorization"),
    ]),
  ).toEqual([
    ["https://akb.test/api/v1/auth/me", "Bearer fixture-initial-access"],
    ["https://akb.test/api/v1/my/vaults", "Bearer fixture-rotated-access"],
  ]);
  expect(mocks.resolveCredential.mock.calls).toEqual([
    [request, handle],
    [request, handle],
  ]);
});
