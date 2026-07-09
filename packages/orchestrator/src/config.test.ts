import { describe, expect, it } from "vitest";
import {
  OrchestratorConfigError,
  loadOrchestratorConfig,
  parseOrchestratorArgs,
  publicOrchestratorConfig,
} from "./config.js";

describe("loadOrchestratorConfig", () => {
  it("loads the minimum dry-run configuration", () => {
    const config = loadOrchestratorConfig({
      argv: ["--dry-run"],
      env: {
        REEF_ORCHESTRATOR_VAULT: "reef-test",
      },
    });

    expect(config).toMatchObject({
      mode: "dry-run",
      dryRun: true,
      vault: "reef-test",
      llm: null,
      githubApp: null,
    });
  });

  it("validates deployment-managed config through core schemas without exposing secrets", () => {
    const config = loadOrchestratorConfig({
      argv: ["--dry-run", "--vault", "reef-test"],
      env: {
        AKB_BASE_URL: "https://akb.example",
        OPENROUTER_API_KEY: "sk-secret",
        OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
        REEF_LLM_MODEL: "openai/gpt-test",
        REEF_GITHUB_APP_ID: "123",
        REEF_GITHUB_APP_INSTALLATION_ID: "456",
        REEF_GITHUB_APP_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\\nsecret\\n-----END RSA PRIVATE KEY-----",
      },
    });

    expect(config.llm?.api_key).toBe("sk-secret");
    expect(config.githubApp?.private_key).toContain("\nsecret\n");
    expect(publicOrchestratorConfig(config)).toEqual(
      expect.objectContaining({
        akb: { isConfigured: true },
        llm: {
          isConfigured: true,
          provider: "openrouter",
          model: "openai/gpt-test",
        },
        githubApp: {
          isConfigured: true,
          appId: "123",
        },
      }),
    );
    expect(JSON.stringify(publicOrchestratorConfig(config))).not.toContain(
      "sk-secret",
    );
    expect(JSON.stringify(publicOrchestratorConfig(config))).not.toContain(
      "secret",
    );
  });

  it("requires a vault", () => {
    expect(() =>
      loadOrchestratorConfig({ argv: ["--dry-run"], env: {} }),
    ).toThrow(OrchestratorConfigError);
  });

  it("treats partial optional deployment settings as unavailable for dry-run startup", () => {
    const config = loadOrchestratorConfig({
      argv: ["--dry-run", "--vault", "reef-test"],
      env: {
        OPENROUTER_API_KEY: "sk-present-locally",
      },
    });

    expect(config.llm).toBeNull();
    expect(publicOrchestratorConfig(config).llm).toEqual({
      isConfigured: false,
      provider: "openrouter",
      model: null,
    });
  });

  it("parses CLI flags", () => {
    expect(
      parseOrchestratorArgs([
        "--",
        "--dry-run",
        "--vault=reef-test",
        "--poll-interval-ms",
        "500",
        "--shutdown-grace-ms=1000",
      ]),
    ).toEqual({
      dryRun: true,
      vault: "reef-test",
      pollIntervalMs: "500",
      shutdownGraceMs: "1000",
    });
  });
});
