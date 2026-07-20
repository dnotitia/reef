import { generateKeyPairSync } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * Hermetic E2E defaults. Playwright exercises reef-web and its Route Handlers
 * for real; only external services are replaced by the local fixture server.
 */
function buildWebServerEnv(): Record<string, string> {
  const llmEnv =
    process.env.REEF_E2E_LLM_DISABLED === "1"
      ? {
          REEF_LLM_API_KEY: "",
          REEF_LLM_BASE_URL: "",
          REEF_LLM_MODEL: "",
        }
      : {
          REEF_LLM_API_KEY:
            process.env.REEF_LLM_API_KEY ?? "e2e-llm-endpoint-key",
          REEF_LLM_BASE_URL:
            process.env.REEF_LLM_BASE_URL ?? `${E2E_MOCK_URL}/openrouter/v1`,
          REEF_LLM_MODEL: process.env.REEF_LLM_MODEL ?? "e2e/mock-model",
        };

  return {
    AKB_BACKEND_URL: process.env.AKB_BACKEND_URL ?? `${E2E_MOCK_URL}/akb`,
    // Keep the hermetic server pinned to canonical names when a developer shell
    // exports the supported OpenRouter compatibility aliases.
    OPENROUTER_API_KEY: "",
    OPENROUTER_BASE_URL: "",
    // Server-read akb web base (REEF-368) so linked-document backlinks render in
    // the hermetic runtime; the backlink spec asserts the open-link href built
    // from this value, proving the runtime server-read path end to end.
    AKB_WEB_URL: process.env.AKB_WEB_URL ?? "https://akb.e2e.test",
    ...llmEnv,
    REEF_GITHUB_API_BASE_URL:
      process.env.REEF_GITHUB_API_BASE_URL ?? `${E2E_MOCK_URL}/github`,
    REEF_GITHUB_APP_ID: process.env.REEF_GITHUB_APP_ID ?? "123456",
    REEF_GITHUB_APP_INSTALLATION_ID:
      process.env.REEF_GITHUB_APP_INSTALLATION_ID ?? "789",
    REEF_GITHUB_APP_PRIVATE_KEY:
      process.env.REEF_GITHUB_APP_PRIVATE_KEY ?? E2E_GITHUB_APP_PRIVATE_KEY,
    // SSO-first login (REEF-312). On under test so the auto-redirect path is
    // exercised; the fixture keeps Keycloak DISABLED by default (so this is a
    // no-op and existing specs render today's panel), and the SSO-first spec
    // opts in per test via the /__e2e/keycloak toggle.
    REEF_SSO_AUTO_REDIRECT: process.env.REEF_SSO_AUTO_REDIRECT ?? "1",
  };
}

const REEF_WEB_URL = process.env.REEF_WEB_URL ?? "http://localhost:7353";
const E2E_MOCK_URL = process.env.REEF_E2E_MOCK_URL ?? "http://127.0.0.1:7354";
const REEF_WEB_PORT = new URL(REEF_WEB_URL).port || "7353";
const E2E_MOCK_PORT = new URL(E2E_MOCK_URL).port || "7354";
const WEB_SERVER_COMMAND =
  process.env.REEF_E2E_WEB_COMMAND?.replaceAll("{port}", REEF_WEB_PORT) ??
  `pnpm --filter @reef/web exec next dev --turbopack -p ${REEF_WEB_PORT}`;
const E2E_GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
})
  .privateKey.export({ type: "pkcs1", format: "pem" })
  .toString();

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.hermetic\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // IndexedDB state is per-browser-context; run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: REEF_WEB_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/harness/mock-server.mjs",
      url: `${E2E_MOCK_URL}/__e2e/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { REEF_E2E_MOCK_PORT: E2E_MOCK_PORT },
    },
    {
      command: WEB_SERVER_COMMAND,
      url: REEF_WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000, // Next.js cold start can be slow
      env: buildWebServerEnv(),
    },
  ],
});
