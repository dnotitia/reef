import { defineConfig, devices } from "@playwright/test";
import { readE2eEnvironment } from "./scripts/e2e-environment.mjs";
import { ssoFixtureConfig } from "./tests/e2e/harness/mock-sso-config.mjs";

const { webOrigin, fixtureOrigin } = readE2eEnvironment();
const ssoConfig = ssoFixtureConfig(webOrigin, fixtureOrigin);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.hermetic\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 15_000 },
  // Test-level sharding; workers=1 serializes access to each shard's mock server.
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webOrigin,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@visual-matrix|@sso/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "visual-matrix",
      grep: /@visual-matrix/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "sso",
      grep: /@sso/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: ssoConfig.publicOrigin,
        ignoreHTTPSErrors: true,
      },
    },
  ],
  webServer: {
    command: "node scripts/e2e-servers.mjs",
    url: `${webOrigin}/api/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 2_000 },
  },
});
