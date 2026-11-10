import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

import { fixtureLogin } from "./mock-fixture-contract.mjs";
import { json, readRawBody } from "./mock-http.mjs";

const MCP_SCOPE = "reef:issues:read";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";

export function createOidcFixture(config, getState) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "fixture-signing-key",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Set();
  const stats = {
    authorizations: 0,
    exchanges: 0,
    jwksReads: 0,
    revocations: 0,
    pkceVerified: false,
    mcpExchanges: 0,
  };
  const resource = `${config.publicOrigin}/mcp`;
  const sign = (payload) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: jwk.kid })
      .sign(privateKey);
  let invalidNonce = false;
  function reset() {
    codes.clear();
    refreshTokens.clear();
    accessTokens.clear();
    for (const key of Object.keys(stats))
      stats[key] = key === "pkceVerified" ? false : 0;
    invalidNonce = false;
  }
  async function tokens(transaction) {
    const now = Math.floor(Date.now() / 1000);
    const user = getState().users.get(fixtureLogin.username);
    const common = {
      iss: config.issuer,
      sub: user.id,
      azp: config.clientId,
      identity_provider: "workforce",
      sid: transaction.sid,
      iat: now,
      exp: now + 600,
    };
    const accessToken = await sign({
      ...common,
      aud: config.audience,
      typ: "Bearer",
      jti: randomUUID(),
      scope: "openid profile email",
    });
    const idToken = await sign({
      ...common,
      aud: config.clientId,
      nonce: invalidNonce ? "invalid-nonce" : transaction.nonce,
      auth_time: now,
      at_hash: createHash("sha256")
        .update(accessToken)
        .digest()
        .subarray(0, 16)
        .toString("base64url"),
    });
    const refreshToken = randomUUID();
    refreshTokens.set(refreshToken, transaction);
    accessTokens.add(accessToken);
    // AKB is a separate external authority: its mock accepts this issued bearer.
    getState().sessions.set(accessToken, user.username);
    return {
      access_token: accessToken,
      id_token: idToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 600,
      refresh_expires_in: 3600,
    };
  }
  async function mintMcpSubject(req, res) {
    const { username, variant } = JSON.parse(
      (await readRawBody(req)).toString(),
    );
    const user = getState().users.get(username);
    if (!user) return json(res, 400, { error: "unknown_fixture_user" });
    const now = Math.floor(Date.now() / 1000);
    return json(res, 200, {
      access_token: await sign({
        iss: config.issuer,
        aud: variant === "wrong-audience" ? config.audience : resource,
        azp: "fixture-dynamic-codex-client",
        sub: user.id,
        sid: randomUUID(),
        typ: "Bearer",
        iat: now - 60,
        exp: variant === "expired" ? now - 1 : now + 600,
        scope: variant === "missing-scope" ? "openid" : `openid ${MCP_SCOPE}`,
      }),
    });
  }

  async function exchangeMcp(p, res) {
    if (
      p.get("client_id") !== resource ||
      p.get("client_secret") !== config.mcpSecret
    )
      return json(res, 401, { error: "invalid_client" });
    if (
      p.get("subject_token_type") !== ACCESS_TOKEN_TYPE ||
      p.get("requested_token_type") !== ACCESS_TOKEN_TYPE ||
      p.has("audience")
    )
      return json(res, 400, { error: "invalid_request" });
    let subject;
    try {
      ({ payload: subject } = await jwtVerify(
        p.get("subject_token") ?? "",
        publicKey,
        {
          algorithms: ["RS256"],
          issuer: config.issuer,
          audience: resource,
        },
      ));
    } catch {
      return json(res, 400, { error: "invalid_grant" });
    }
    const user = [...getState().users.values()].find(
      ({ id }) => id === subject.sub,
    );
    if (!user) return json(res, 400, { error: "invalid_grant" });
    const accessToken = await sign({
      iss: config.issuer,
      aud: config.audience,
      azp: resource,
      sub: subject.sub,
      sid: subject.sid,
      iat: Math.floor(Date.now() / 1000),
      exp: subject.exp,
      typ: "Bearer",
      jti: randomUUID(),
    });
    accessTokens.add(accessToken);
    getState().sessions.set(accessToken, user.username);
    stats.mcpExchanges++;
    return json(res, 200, {
      access_token: accessToken,
      issued_token_type: ACCESS_TOKEN_TYPE,
      token_type: "Bearer",
    });
  }
  async function handle(req, res, url) {
    const endpoint = url.pathname;
    if (endpoint === "/realms/reef/protocol/openid-connect/certs") {
      stats.jwksReads++;
      return json(res, 200, { keys: [jwk] });
    }
    if (endpoint === "/realms/reef/protocol/openid-connect/auth") {
      const p = url.searchParams;
      if (
        p.get("client_id") !== config.clientId ||
        p.get("redirect_uri") !==
          `${config.publicOrigin}/api/auth/akb/sso/callback` ||
        p.get("code_challenge_method") !== "S256" ||
        p.get("response_type") !== "code" ||
        !p.get("state") ||
        !p.get("nonce") ||
        !p.get("code_challenge") ||
        p.get("kc_idp_hint") !== "workforce"
      )
        return json(res, 400, { error: "invalid_authorization_request" });
      const code = randomUUID();
      codes.set(code, {
        nonce: p.get("nonce"),
        state: p.get("state"),
        redirectUri: p.get("redirect_uri"),
        challenge: p.get("code_challenge"),
        sid: randomUUID(),
      });
      stats.authorizations++;
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      });
      return res.end(
        `<!doctype html><html lang="en"><title>Fixture identity provider</title><main data-testid="fixture-keycloak-authorize"><h1>Fixture sign-in</h1><a href="/realms/reef/continue?code=${code}">Continue</a></main></html>`,
      );
    }
    if (endpoint === "/realms/reef/continue") {
      const code = url.searchParams.get("code");
      const transaction = codes.get(code);
      if (!transaction) return json(res, 400, { error: "invalid_code" });
      const callback = new URL(transaction.redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", transaction.state);
      res.writeHead(302, { Location: callback.toString() });
      return res.end();
    }
    if (
      endpoint === "/realms/reef/protocol/openid-connect/token" &&
      req.method === "POST"
    ) {
      const p = new URLSearchParams((await readRawBody(req)).toString());
      if (p.get("grant_type") === EXCHANGE_GRANT) return exchangeMcp(p, res);
      if (p.get("client_id") !== config.clientId)
        return json(res, 400, { error: "invalid_client" });
      let transaction;
      if (p.get("grant_type") === "authorization_code") {
        const code = p.get("code");
        transaction = codes.get(code);
        codes.delete(code);
        const challenge = createHash("sha256")
          .update(p.get("code_verifier") ?? "")
          .digest("base64url");
        if (
          !transaction ||
          challenge !== transaction.challenge ||
          p.get("redirect_uri") !== transaction.redirectUri
        )
          return json(res, 400, { error: "invalid_grant" });
        stats.pkceVerified = true;
      } else if (p.get("grant_type") === "refresh_token") {
        const token = p.get("refresh_token");
        transaction = refreshTokens.get(token);
        refreshTokens.delete(token);
      }
      if (!transaction) return json(res, 400, { error: "invalid_grant" });
      stats.exchanges++;
      return json(res, 200, await tokens(transaction));
    }
    if (
      endpoint === "/realms/reef/protocol/openid-connect/revoke" &&
      req.method === "POST"
    ) {
      const p = new URLSearchParams((await readRawBody(req)).toString());
      refreshTokens.delete(p.get("token"));
      stats.revocations++;
      return json(res, 200, {});
    }
    if (endpoint === "/realms/reef/protocol/openid-connect/logout") {
      res.writeHead(302, {
        Location: `${config.publicOrigin}/login?prompt=login`,
      });
      return res.end();
    }
    return json(res, 404, { error: "unknown_oidc_endpoint" });
  }
  return {
    handle,
    reset,
    accessTokens,
    stats,
    mintMcpSubject,
    setInvalidNonce: (value) => {
      invalidNonce = value;
    },
  };
}
