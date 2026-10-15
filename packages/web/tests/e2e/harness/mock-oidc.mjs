import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { fixtureLogin } from "./mock-fixtures.mjs";
import { json, readRawBody } from "./mock-http.mjs";

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
  };
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
    const sign = (payload) =>
      new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: jwk.kid })
        .sign(privateKey);
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
    setInvalidNonce: (value) => {
      invalidNonce = value;
    },
  };
}
