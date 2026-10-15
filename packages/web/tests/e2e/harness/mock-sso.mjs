import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { request } from "node:http";
import { createOidcFixture } from "./mock-oidc.mjs";
import { createRedisFixture } from "./mock-redis.mjs";
import { ssoFixtureConfig } from "./mock-sso-config.mjs";

/** TLS termination and external OIDC/Redis fixtures; Reef handlers are untouched. */
export async function startSsoFixture(getState) {
  const webUrl = new URL(process.env.REEF_WEB_URL);
  const config = ssoFixtureConfig(webUrl.href, process.env.REEF_E2E_MOCK_URL);
  const oidc = createOidcFixture(config, getState);
  const redis = createRedisFixture();
  const proxy = createServer(
    {
      key: await readFile(new URL("./sso/localhost-key.pem", import.meta.url)),
      cert: await readFile(
        new URL("./sso/localhost-cert.pem", import.meta.url),
      ),
    },
    (req, res) => {
      if (!req.url.startsWith("/") || req.url.startsWith("//")) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, config.publicOrigin);
      if (url.pathname.startsWith("/realms/reef/")) {
        oidc.handle(req, res, url).catch(() => {
          res.writeHead(500);
          res.end();
        });
        return;
      }
      const upstream = request(
        {
          hostname: webUrl.hostname,
          port: webUrl.port,
          path: `${url.pathname}${url.search}`,
          method: req.method,
          headers: {
            ...req.headers,
            "x-forwarded-proto": "https",
            "x-forwarded-host": req.headers.host,
          },
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await redis.listen(config.redisPort);
  await new Promise((resolve) =>
    proxy.listen(config.tlsPort, "127.0.0.1", resolve),
  );
  return {
    oidc,
    reset() {
      oidc.reset();
      redis.reset();
    },
    observation() {
      const sessions = [...redis.records].filter(([key]) =>
        key.includes(":session:"),
      );
      return {
        ...oidc.stats,
        sessionRecords: sessions.length,
        loginRecords: [...redis.records.keys()].filter((key) =>
          key.includes(":login:"),
        ).length,
        encryptedSessions: sessions.every(
          ([, entry]) =>
            typeof entry.value === "string" &&
            /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(
              entry.value,
            ),
        ),
        bearerForwarded: getState().ssoBearerForwarded === true,
      };
    },
    close() {
      redis.close();
      proxy.closeAllConnections();
      proxy.close();
    },
  };
}
