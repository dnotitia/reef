const DEFAULT_WEB_ORIGIN = "http://localhost:7353";
export const DEFAULT_FIXTURE_ORIGIN = "http://127.0.0.1:7354";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * @typedef {{ webOrigin: string, fixtureOrigin: string, authMode: "local" | "sso" }} E2eEnvironment
 */

/** @returns {E2eEnvironment} */
export function readE2eEnvironment(
  env = process.env,
  { authMode = env.REEF_E2E_AUTH_MODE ?? "local", portOffset = 0 } = {},
) {
  if (authMode !== "local" && authMode !== "sso") {
    throw new Error("REEF_E2E_AUTH_MODE must be local or sso");
  }
  return {
    webOrigin: readOrigin(env, "REEF_WEB_URL", DEFAULT_WEB_ORIGIN, portOffset),
    fixtureOrigin: readOrigin(
      env,
      "REEF_E2E_MOCK_URL",
      DEFAULT_FIXTURE_ORIGIN,
      portOffset,
    ),
    authMode,
  };
}

function readOrigin(env, name, defaultValue, portOffset) {
  const value = env[name] ?? defaultValue;
  const url = URL.parse(value);
  if (
    !url ||
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(`${name} must be a credential-free loopback HTTP origin`);
  }
  const port = Number(url.port || 80) + portOffset;
  if (port < 1 || port > 65_535) {
    throw new Error(`${name} produces an invalid E2E port`);
  }
  url.port = String(port);
  return url.origin;
}

/** @param {E2eEnvironment} environment */
export function e2eEnvironmentVariables({
  webOrigin,
  fixtureOrigin,
  authMode,
}) {
  return {
    REEF_WEB_URL: webOrigin,
    REEF_E2E_MOCK_URL: fixtureOrigin,
    REEF_E2E_AUTH_MODE: authMode,
  };
}
