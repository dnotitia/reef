// @vitest-environment node
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authenticateMcp, mcpAuthError } from "./mcpAuth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const issuer = "https://identity.test/realms/reef";
const origin = "https://reef.test";
const resource = `${origin}/mcp`;
const audience = "https://akb.test/api";
const oidc = `${issuer}/protocol/openid-connect`;
const tokenType = "urn:ietf:params:oauth:token-type:access_token";

function sign(claims: JWTPayload) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    iss: issuer,
    aud: resource,
    sub: "identity-alice",
    sid: "session-alice",
    azp: "dynamic-codex",
    typ: "Bearer",
    iat: now,
    exp: now + 60,
    scope: "openid reef:issues:read",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(privateKey);
}

beforeEach(() => {
  vi.stubEnv("REEF_AUTH_MODE", "sso");
  vi.stubEnv("REEF_KEYCLOAK_ISSUER", issuer);
  vi.stubEnv("REEF_KEYCLOAK_TRANSPORT_URL", "");
  vi.stubEnv("REEF_KEYCLOAK_CLIENT_ID", "reef-web");
  vi.stubEnv("REEF_AKB_API_AUDIENCE", audience);
  vi.stubEnv("REEF_PUBLIC_ORIGIN", origin);
  vi.stubEnv("REEF_MCP_EXCHANGE_CLIENT_SECRET", "fixture-secret");
  vi.stubEnv("AKB_BACKEND_URL", "https://akb.test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function requestWith(token: string) {
  return new Request(resource, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

function mockExchange(exchange: Response) {
  const fetchUpstream = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === `${oidc}/certs`) {
      return Response.json({
        keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test" }],
      });
    }
    if (String(url) === `${oidc}/token`) return exchange;
    if (String(url) === "https://akb.test/api/v1/auth/me") {
      expect(new Headers(init?.headers).get("Authorization")).toMatch(
        /^Bearer /u,
      );
      return Response.json({ username: "alice" });
    }
    throw new Error("Unexpected upstream URL");
  });
  vi.stubGlobal("fetch", fetchUpstream);
  return fetchUpstream;
}

function akbCalls(fetchUpstream: ReturnType<typeof mockExchange>) {
  return fetchUpstream.mock.calls.filter(([url]) =>
    String(url).startsWith("https://akb.test/"),
  );
}

function tokenResponse(token: string) {
  return Response.json({
    access_token: token,
    token_type: "Bearer",
    issued_token_type: tokenType,
  });
}

it("sends only the exchanged bearer to the AKB account check", async () => {
  const subject = await sign({});
  const exchanged = await sign({
    aud: audience,
    azp: resource,
    jti: randomUUID(),
  });
  const fetchUpstream = mockExchange(tokenResponse(exchanged));
  await authenticateMcp(requestWith(subject));

  const exchange = fetchUpstream.mock.calls.find(
    ([url]) => String(url) === `${oidc}/token`,
  );
  expect(exchange?.[1]).toMatchObject({
    method: "POST",
    redirect: "error",
    cache: "no-store",
  });
  const form = exchange?.[1]?.body;
  expect(form instanceof URLSearchParams && Object.fromEntries(form)).toEqual({
    client_id: resource,
    client_secret: "fixture-secret",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: subject,
    subject_token_type: tokenType,
    requested_token_type: tokenType,
  });
  const forwarded = akbCalls(fetchUpstream);
  expect(forwarded).toHaveLength(1);
  expect(new Headers(forwarded[0]?.[1]?.headers).get("Authorization")).toBe(
    `Bearer ${exchanged}`,
  );
});

it.each([
  ["subject", { sub: "identity-bob" }],
  ["session", { sid: "other-session" }],
  ["authorized party", { azp: "reef-web" }],
  ["audience", { aud: [audience, resource] }],
])(
  "refuses an exchange with the wrong %s before calling AKB",
  async (_field, mismatch) => {
    const token = await sign({ aud: audience, azp: resource, ...mismatch });
    const fetchUpstream = mockExchange(tokenResponse(token));
    const response = await authenticateMcp(requestWith(await sign({}))).catch(
      mcpAuthError,
    );

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Unexpected adapter");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(akbCalls(fetchUpstream)).toHaveLength(0);
  },
);

it.each([
  ["invalid_grant", 400, 401],
  ["invalid_client", 401, 503],
])(
  "maps Keycloak %s without calling AKB",
  async (error, upstreamStatus, status) => {
    const fetchUpstream = mockExchange(
      Response.json({ error }, { status: upstreamStatus }),
    );
    const response = await authenticateMcp(requestWith(await sign({}))).catch(
      mcpAuthError,
    );

    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("Unexpected adapter");
    expect(response.status).toBe(status);
    expect(response.headers.has("WWW-Authenticate")).toBe(status === 401);
    expect(akbCalls(fetchUpstream)).toHaveLength(0);
  },
);
