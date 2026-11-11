import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { loadAkbAuthConfig } from "@/lib/akb/loadAkbAuthConfig";
import { getProcessAuthV2Redis } from "@/server/auth-v2/redisRuntime";
import { getAuthV2RouteRuntime } from "@/server/auth-v2/runtime";
import {
  AUTH_V2_ABSOLUTE_LIFETIME_SECONDS,
  type AuthV2SessionRecord,
} from "@/server/auth-v2/sessionStore";
import { GET } from "./route";

vi.mock("@/lib/akb/loadAkbAuthConfig");
vi.mock("@/server/auth-v2/redisRuntime");

const REEF_ORIGIN = "https://reef.test";
const AKB_ORIGIN = "https://akb.test";
const ISSUER = "https://idp.test/realms/reef";
const CLIENT_ID = "reef-web";
const AUDIENCE = `${AKB_ORIGIN}/api`;
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;
const CERTS_URL = `${ISSUER}/protocol/openid-connect/certs`;
const AKB_ME_URL = `${AKB_ORIGIN}/api/v1/auth/me`;
const ISSUED_AT = 2_000_000_000;
const REFRESH_AT = ISSUED_AT + 60;
const SESSION: AuthV2SessionRecord = {
  provider_alias: "workforce",
  subject: "subject-1",
  session_id: "sid-1",
  access_token: "expired-access",
  refresh_token: "refresh-1",
  id_token: "id-1",
  issued_at: ISSUED_AT,
  access_token_expires_at: REFRESH_AT,
  refresh_token_expires_at: ISSUED_AT + 600,
  absolute_expires_at: ISSUED_AT + AUTH_V2_ABSOLUTE_LIFETIME_SECONDS,
};
const PROFILE = { user_id: "u-1", username: "alice" };

let refreshedAccessToken: string;
let jwks: { keys: JWK[] };

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "key-1" }] };
  refreshedAccessToken = await new SignJWT({
    azp: CLIENT_ID,
    typ: "Bearer",
    jti: "jti-1",
    sid: SESSION.session_id,
    identity_provider: SESSION.provider_alias,
    scope: "openid profile",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "key-1" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(SESSION.subject)
    .setIssuedAt(REFRESH_AT)
    .setExpirationTime(REFRESH_AT + 300)
    .sign(privateKey);
});

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AKB_BACKEND_URL", AKB_ORIGIN);
  vi.stubEnv("REEF_AUTH_MODE", "sso");
  vi.stubEnv("REEF_KEYCLOAK_ISSUER", ISSUER);
  vi.stubEnv("REEF_KEYCLOAK_TRANSPORT_URL", undefined);
  vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("REEF_AKB_API_AUDIENCE", AUDIENCE);
  vi.stubEnv("REEF_PUBLIC_ORIGIN", REEF_ORIGIN);
  vi.stubEnv("REEF_SESSION_REDIS_URL", "redis://localhost:6379");
  vi.stubEnv(
    "REEF_SESSION_ENCRYPTION_KEY",
    Buffer.alloc(32, 7).toString("base64"),
  );
  vi.stubEnv("REEF_AUTH_SESSION_NAMESPACE", "reef-test");
  vi.mocked(loadAkbAuthConfig).mockResolvedValue({
    ok: true,
    config: {
      schema_version: 2,
      auth_mode: "sso",
      local_auth: { enabled: false },
      keycloak: { enabled: true, browser_session_ready: true },
      providers: [
        {
          provider_type: "keycloak-oidc",
          alias: SESSION.provider_alias,
          display_name: "Company SSO",
          login_url: "/api/v1/auth/sso/workforce/login",
        },
      ],
      mcp_oauth: { enabled: false },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function startExpiredSession() {
  const records = new Map<string, string>();
  vi.mocked(getProcessAuthV2Redis).mockResolvedValue({
    backend: {
      async set(key, value) {
        records.set(key, value);
      },
      async get(key) {
        return records.get(key) ?? null;
      },
      async del(key) {
        records.delete(key);
      },
      async consume(key) {
        const value = records.get(key) ?? null;
        records.delete(key);
        return value;
      },
      async replace(key, expected, value) {
        if (records.get(key) !== expected) return false;
        records.set(key, value);
        return true;
      },
    },
    refreshLock: {
      acquire: async () => "owner",
      release: async () => undefined,
    },
    ping: async () => "PONG",
  });
  const tokenEndpoint = vi.fn<typeof fetch>();
  const akbMe = vi.fn<typeof fetch>(async () => Response.json(PROFILE));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    switch (String(url)) {
      case TOKEN_URL:
        return tokenEndpoint(url, init);
      case CERTS_URL:
        return Response.json(jwks);
      case AKB_ME_URL:
        return akbMe(url, init);
      default:
        throw new Error(`Unexpected request to ${String(url)}`);
    }
  });

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ISSUED_AT * 1_000);
  const { store } = await getAuthV2RouteRuntime(new Request(REEF_ORIGIN));
  const { handle } = await store.issue(SESSION);
  vi.setSystemTime(REFRESH_AT * 1_000);
  const headers = { cookie: `__reef_auth_v2=${handle}` };
  return {
    tokenEndpoint,
    akbMe,
    getMe: () =>
      GET(new Request(`${REEF_ORIGIN}/api/auth/akb/me`, { headers })),
    resolveSession: () => store.resolve(handle),
  };
}

describe("GET /api/auth/akb/me SSO refresh", () => {
  it.each([
    ["HTTP 429", async () => new Response(null, { status: 429 })],
    ["HTTP 503", async () => new Response(null, { status: 503 })],
    [
      "a network failure",
      async () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("keeps the session retryable after %s", async (_failure, respond) => {
    const { tokenEndpoint, akbMe, getMe, resolveSession } =
      await startExpiredSession();
    tokenEndpoint.mockImplementationOnce(respond).mockResolvedValueOnce(
      Response.json({
        access_token: refreshedAccessToken,
        refresh_token: "refresh-2",
        token_type: "Bearer",
        expires_in: 300,
        refresh_expires_in: 600,
      }),
    );

    const failed = await getMe();

    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    expect(akbMe).not.toHaveBeenCalled();
    expect
      .soft({
        status: failed.status,
        invalidated: failed.headers.get("x-reef-auth-invalidated"),
        setCookie: failed.headers.get("set-cookie"),
      })
      .toEqual({ status: 502, invalidated: null, setCookie: null });
    expect.soft(await resolveSession()).toEqual(SESSION);

    const recovered = await getMe();

    expect.soft(recovered.status).toBe(200);
    expect.soft(await recovered.json()).toEqual(PROFILE);
    expect(tokenEndpoint).toHaveBeenCalledTimes(2);
    expect(akbMe).toHaveBeenCalledTimes(1);
    expect(
      new Headers(akbMe.mock.calls[0]?.[1]?.headers).get("authorization"),
    ).toBe(`Bearer ${refreshedAccessToken}`);
  });

  it("invalidates and removes the session after HTTP 400 invalid_grant", async () => {
    const { tokenEndpoint, akbMe, getMe, resolveSession } =
      await startExpiredSession();
    tokenEndpoint.mockResolvedValueOnce(
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );

    const response = await getMe();

    expect(response.status).toBe(401);
    expect(response.headers.get("x-reef-auth-invalidated")).toBe("1");
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^__reef_auth_v2=;.*Max-Age=0/u),
    );
    expect(tokenEndpoint).toHaveBeenCalledTimes(1);
    expect(akbMe).not.toHaveBeenCalled();
    await expect(resolveSession()).resolves.toBeNull();
  });
});
