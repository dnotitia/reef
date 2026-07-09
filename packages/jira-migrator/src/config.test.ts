import { describe, expect, it } from "vitest";
import {
  JiraMigratorConfigError,
  loadJiraMigratorConfig,
  parseJiraMigratorArgs,
  publicJiraMigratorConfig,
  redactForConfig,
  secretValuesForConfig,
} from "./config.js";

const env = {
  REEF_JIRA_BASE_URL: "https://example.atlassian.net///",
  REEF_JIRA_CLOUD_ID: "cloud-1",
  REEF_JIRA_PROJECT_KEY: "shdev",
  REEF_JIRA_EMAIL: "operator@example.com",
  REEF_JIRA_API_TOKEN: "jira-secret-token",
  REEF_JIRA_MIGRATOR_VAULT: "reef-test",
};

describe("loadJiraMigratorConfig", () => {
  it("loads operator config and keeps public config secret-free", () => {
    const config = loadJiraMigratorConfig({
      argv: ["--dry-run", "--report=reports/shdev.json"],
      env,
    });

    expect(config).toMatchObject({
      dryRun: true,
      targetVault: "reef-test",
      reportPath: "reports/shdev.json",
      jira: {
        baseUrl: "https://example.atlassian.net",
        cloudId: "cloud-1",
        projectKey: "SHDEV",
      },
    });
    expect(config.jira.auth).toMatchObject({
      mode: "basic",
      email: "operator@example.com",
      apiToken: "jira-secret-token",
    });

    const publicJson = JSON.stringify(publicJiraMigratorConfig(config));
    expect(publicJson).toContain("operator@example.com");
    expect(publicJson).not.toContain("jira-secret-token");
    expect(publicJson).not.toContain("Basic ");
  });

  it("can derive an Atlassian API gateway base URL from cloud id", () => {
    const config = loadJiraMigratorConfig({
      argv: ["--project-key", "SDDEV", "--vault", "reef-test"],
      env: {
        REEF_JIRA_CLOUD_ID: "cloud-abc",
        REEF_JIRA_BEARER_TOKEN: "bearer-secret",
      },
    });

    expect(config.jira.baseUrl).toBe(
      "https://api.atlassian.com/ex/jira/cloud-abc",
    );
    expect(publicJiraMigratorConfig(config).jira.auth).toEqual({
      mode: "bearer",
      isConfigured: true,
      email: null,
    });
  });

  it("redacts raw token values and derived auth headers from arbitrary reports", () => {
    const config = loadJiraMigratorConfig({ env });
    const secrets = secretValuesForConfig(config);
    const report = redactForConfig(config, {
      note: "jira-secret-token",
      header: secrets.find((value) => value.startsWith("Basic ")),
    });

    expect(JSON.stringify(report)).not.toContain("jira-secret-token");
    expect(JSON.stringify(report)).not.toContain("Basic ");
    expect(JSON.stringify(report)).toContain("[redacted]");
  });

  it("keeps validation errors free of credential values", () => {
    expect(() =>
      loadJiraMigratorConfig({
        env: {
          ...env,
          REEF_JIRA_BASE_URL: "http://not-allowed.example",
        },
      }),
    ).toThrow(JiraMigratorConfigError);

    try {
      loadJiraMigratorConfig({
        env: {
          ...env,
          REEF_JIRA_BASE_URL: "http://not-allowed.example",
        },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("jira-secret-token");
    }
  });

  it("parses CLI flags without accepting secret values on the command line", () => {
    expect(
      parseJiraMigratorArgs([
        "--",
        "--dry-run",
        "--jira-base-url=https://example.atlassian.net",
        "--jira-cloud-id",
        "cloud-1",
        "--project-key",
        "SHDEV",
        "--vault=reef-test",
        "--report",
        "reports/out.json",
        "--api-token-file",
        ".secrets/jira-token",
      ]),
    ).toEqual({
      dryRun: true,
      jiraBaseUrl: "https://example.atlassian.net",
      cloudId: "cloud-1",
      projectKey: "SHDEV",
      vault: "reef-test",
      reportPath: "reports/out.json",
      apiTokenFile: ".secrets/jira-token",
      bearerTokenFile: null,
    });
  });
});
