/** Public test-only constants; never use these credentials in a deployment. */
export function ssoFixtureConfig(webUrl, mockUrl) {
  const tlsPort = Number(new URL(webUrl).port) + 3;
  const redisPort = Number(new URL(mockUrl).port) + 1;
  return {
    publicOrigin: `https://localhost:${tlsPort}`,
    issuer: `https://oidc.localhost:${tlsPort}/realms/reef`,
    transportUrl: `http://localhost:${new URL(mockUrl).port}/realms/reef`,
    redisUrl: `redis://:fixture-password@localhost:${redisPort}`,
    tlsPort,
    redisPort,
    clientId: "reef-e2e",
    audience: "reef-akb-e2e",
  };
}
