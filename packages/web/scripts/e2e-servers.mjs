import { fork, spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { resolve } from "node:path";
import {
  E2E_REEF_APP_ID,
  E2E_REEF_IMAGE_DIGEST,
  E2E_REEF_MANIFEST_CHECKSUM,
  E2E_REEF_RELEASE_ID,
  E2E_REEF_RELEASE_VERSION,
  E2E_REEF_SOURCE_REVISION,
} from "../tests/e2e/harness/mock-installation.mjs";
import { ssoFixtureConfig } from "../tests/e2e/harness/mock-sso-config.mjs";
import {
  e2eEnvironmentVariables,
  readE2eEnvironment,
} from "./e2e-environment.mjs";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const environment = readE2eEnvironment();
const fixtureEnv = { ...process.env, ...e2eEnvironmentVariables(environment) };
const children = new Set();
let stopping = false;

function webServerEnv() {
  const { webOrigin, fixtureOrigin, authMode } = environment;
  const webUrl = new URL(webOrigin);
  const sso = authMode === "sso";
  const ssoConfig = ssoFixtureConfig(webOrigin, fixtureOrigin);
  const llmEnabled = !sso && process.env.REEF_E2E_LLM_DISABLED !== "1";
  return {
    ...fixtureEnv,
    PORT: webUrl.port || "80",
    HOSTNAME:
      webUrl.hostname === "localhost"
        ? "127.0.0.1"
        : webUrl.hostname.replace(/^\[|\]$/gu, ""),
    AKB_BACKEND_URL: `${fixtureOrigin}/akb`,
    AKB_WEB_URL: process.env.AKB_WEB_URL ?? "https://akb.e2e.test",
    REEF_AUTH_MODE: authMode,
    ...(sso
      ? {
          REEF_PUBLIC_ORIGIN: ssoConfig.publicOrigin,
          REEF_KEYCLOAK_ISSUER: ssoConfig.issuer,
          REEF_KEYCLOAK_TRANSPORT_URL: ssoConfig.transportUrl,
          REEF_KEYCLOAK_CLIENT_ID: ssoConfig.clientId,
          REEF_AKB_API_AUDIENCE: ssoConfig.audience,
          REEF_MCP_EXCHANGE_CLIENT_SECRET: ssoConfig.mcpSecret,
          REEF_SESSION_REDIS_URL: ssoConfig.redisUrl,
          REEF_SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString(
            "base64url",
          ),
          REEF_AUTH_SESSION_NAMESPACE: "reef-e2e-sso",
        }
      : {}),
    REEF_SSO_AUTO_REDIRECT: process.env.REEF_SSO_AUTO_REDIRECT ?? "1",
    REEF_APP_ID: E2E_REEF_APP_ID,
    REEF_RELEASE_ID: E2E_REEF_RELEASE_ID,
    REEF_RELEASE_VERSION: E2E_REEF_RELEASE_VERSION,
    REEF_RELEASE_SOURCE_REVISION: E2E_REEF_SOURCE_REVISION,
    REEF_RELEASE_IMAGE_DIGEST: E2E_REEF_IMAGE_DIGEST,
    REEF_RELEASE_MANIFEST_CHECKSUM: E2E_REEF_MANIFEST_CHECKSUM,
    REEF_LLM_API_KEY: llmEnabled
      ? (process.env.REEF_LLM_API_KEY ?? "e2e-llm-endpoint-key")
      : "",
    REEF_LLM_BASE_URL: llmEnabled
      ? (process.env.REEF_LLM_BASE_URL ?? `${fixtureOrigin}/openrouter/v1`)
      : "",
    REEF_LLM_MODEL: llmEnabled
      ? (process.env.REEF_LLM_MODEL ?? "e2e/mock-model")
      : "",
    REEF_GITHUB_API_BASE_URL:
      process.env.REEF_GITHUB_API_BASE_URL ?? `${fixtureOrigin}/github`,
    REEF_GITHUB_APP_ID: process.env.REEF_GITHUB_APP_ID ?? "123456",
    REEF_GITHUB_APP_INSTALLATION_ID:
      process.env.REEF_GITHUB_APP_INSTALLATION_ID ?? "789",
    REEF_GITHUB_APP_PRIVATE_KEY:
      process.env.REEF_GITHUB_APP_PRIVATE_KEY ??
      generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs1", format: "pem" })
        .toString(),
  };
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 1_000).unref();
}

function track(child, name) {
  children.add(child);
  function ended(reason) {
    children.delete(child);
    if (stopping) return;
    process.stderr.write(`[e2e:servers] ${name} stopped with ${reason}\n`);
    stop(1);
  }
  child.once("error", (error) => ended(error.message));
  child.once("exit", (code, signal) => ended(signal ?? `exit code ${code}`));
  return child;
}

process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));

const webEnv = webServerEnv();
const fixture = track(
  fork("tests/e2e/harness/mock-server.mjs", {
    cwd: PACKAGE_ROOT,
    env: fixtureEnv,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  }),
  "fixture server",
);

fixture.once("message", () => {
  if (stopping) return;
  track(
    spawn(process.execPath, [".next/standalone/packages/web/server.js"], {
      cwd: PACKAGE_ROOT,
      env: webEnv,
      stdio: "inherit",
    }),
    "reef-web",
  );
});
