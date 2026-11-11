/** Public test-only constants; never use these credentials in a deployment. */
export function ssoFixtureConfig(webOrigin, fixtureOrigin) {
  const tlsPort = Number(new URL(webOrigin).port || 80) + 3;
  const fixturePort = Number(new URL(fixtureOrigin).port || 80);
  const redisPort = fixturePort + 1;
  return {
    publicOrigin: `https://localhost:${tlsPort}`,
    issuer: `https://oidc.localhost:${tlsPort}/realms/reef`,
    transportUrl: `http://localhost:${fixturePort}/realms/reef`,
    redisUrl: `redis://:fixture-password@localhost:${redisPort}`,
    tlsPort,
    redisPort,
    clientId: "reef-e2e",
    audience: "reef-akb-e2e",
    mcpSecret: "fixture-mcp-exchange",
  };
}
