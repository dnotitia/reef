import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  REEF_JIRA_PROJECT_KEY: "alpha",
  REEF_JIRA_EMAIL: "operator@example.com",
  REEF_JIRA_API_TOKEN: "jira-secret-token",
  REEF_JIRA_MIGRATOR_VAULT: "reef-test",
  AKB_BACKEND_URL: "https://akb.example.test",
  REEF_AKB_JWT: "akb-secret-token",
};

describe("loadJiraMigratorConfig", () => {
  it("loads operator config and keeps public config secret-free", () => {
    const config = loadJiraMigratorConfig({
      argv: ["--dry-run", "--report=reports/alpha.json"],
      env,
    });

    expect(config).toMatchObject({
      mode: "dry-run",
      dryRun: true,
      targetVault: "reef-test",
      reportPath: "reports/alpha.json",
      accountMappingPath: null,
      jira: {
        baseUrl: "https://example.atlassian.net",
        cloudId: "cloud-1",
        projectKey: "ALPHA",
        projectKeys: ["ALPHA"],
      },
      target: {
        baseUrl: "https://akb.example.test",
        vault: "reef-test",
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
      argv: [
        "--dry-run",
        "--project-key",
        "BETA",
        "--vault",
        "reef-test",
        "--account-mapping",
        "artifacts/jira-account-mapping.cloud-abc.json",
      ],
      env: {
        REEF_JIRA_CLOUD_ID: "cloud-abc",
        REEF_JIRA_BEARER_TOKEN: "bearer-secret",
        AKB_BACKEND_URL: "https://akb.example.test",
        REEF_AKB_JWT: "akb-secret-token",
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
    expect(publicJiraMigratorConfig(config).accountMappingPath).toBe(
      "artifacts/jira-account-mapping.cloud-abc.json",
    );
  });

  it("redacts raw token values and derived auth headers from arbitrary reports", () => {
    const config = loadJiraMigratorConfig({ argv: ["--dry-run"], env });
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
        argv: ["--dry-run"],
        env: {
          ...env,
          REEF_JIRA_BASE_URL: "http://not-allowed.example",
        },
      }),
    ).toThrow(JiraMigratorConfigError);

    try {
      loadJiraMigratorConfig({
        argv: ["--dry-run"],
        env: {
          ...env,
          REEF_JIRA_BASE_URL: "http://not-allowed.example",
        },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("jira-secret-token");
    }

    expect(() =>
      loadJiraMigratorConfig({
        env: {
          ...env,
          REEF_JIRA_BASE_URL:
            "https://embedded-user:embedded-secret@example.atlassian.net",
        },
      }),
    ).toThrow(JiraMigratorConfigError);

    try {
      loadJiraMigratorConfig({
        env: {
          ...env,
          REEF_JIRA_BASE_URL:
            "https://embedded-user:embedded-secret@example.atlassian.net",
        },
      });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("embedded-user");
      expect(JSON.stringify(error)).not.toContain("embedded-secret");
    }

    for (const baseUrl of [
      "https://@example.atlassian.net",
      "https://:@example.atlassian.net",
      "https:@example.atlassian.net",
      "https:\\@example.atlassian.net",
      "ht\ntps://@example.atlassian.net",
    ]) {
      expect(() =>
        loadJiraMigratorConfig({
          argv: ["--dry-run"],
          env: { ...env, REEF_JIRA_BASE_URL: baseUrl },
        }),
      ).toThrow(JiraMigratorConfigError);
    }

    expect(
      loadJiraMigratorConfig({
        argv: ["--dry-run"],
        env: {
          ...env,
          REEF_JIRA_BASE_URL: "https://example.atlassian.net/path@segment",
        },
      }).jira.baseUrl,
    ).toBe("https://example.atlassian.net/path@segment");
    expect(
      loadJiraMigratorConfig({
        argv: ["--dry-run"],
        env: {
          ...env,
          REEF_JIRA_BASE_URL: "https://example.atlassian.net\\path@segment",
        },
      }).jira.baseUrl,
    ).toBe("https://example.atlassian.net/path@segment");
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
        "ALPHA",
        "--vault=reef-test",
        "--report",
        "reports/out.json",
        "--account-mapping=artifacts/accounts.json",
        "--api-token-file",
        ".secrets/jira-token",
      ]),
    ).toMatchObject({
      dryRun: true,
      apply: false,
      jiraBaseUrl: "https://example.atlassian.net",
      cloudId: "cloud-1",
      projectKeys: ["ALPHA"],
      vault: "reef-test",
      reportPath: "reports/out.json",
      accountMappingPath: "artifacts/accounts.json",
      apiTokenFile: ".secrets/jira-token",
      bearerTokenFile: null,
    });
  });

  it("requires exactly one mode before any target can be constructed", () => {
    expect(() => loadJiraMigratorConfig({ argv: [], env })).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "Exactly one of --dry-run or --apply is required",
        ]),
      }),
    );
    expect(() =>
      loadJiraMigratorConfig({
        argv: ["--dry-run", "--apply"],
        env,
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "Exactly one of --dry-run or --apply is required",
        ]),
      }),
    );
  });

  it("uses one schema for repeated projects, boards, and mapping policies", () => {
    const config = loadJiraMigratorConfig({
      argv: [
        "--dry-run",
        "--project-key",
        "beta",
        "--project-key=ALPHA",
        "--board-id",
        "42",
        "--board-id=7",
        "--mapping-policy",
        "ALPHA=/private/policies/alpha.json",
        "--mapping-policy=BETA=/private/policies/beta.json",
        "--run-id",
        "run-alpha-beta",
        "--ledger-path",
        "/private/artifacts/ledger.json",
        "--archive-root",
        "/private/artifacts/archive",
        "--report-path",
        "/private/artifacts/report.json",
        "--retry-count",
        "4",
        "--retry-base-delay-ms",
        "100",
        "--retry-max-delay-ms",
        "4000",
      ],
      env: {
        ...env,
        REEF_JIRA_PROJECT_KEY: undefined,
      },
    });

    expect(config.jira.projectKeys).toEqual(["ALPHA", "BETA"]);
    expect(config.jira.boardIds).toEqual(["7", "42"]);
    expect(config.jira.mappingPolicyPaths).toEqual({
      ALPHA: "/private/policies/alpha.json",
      BETA: "/private/policies/beta.json",
    });
    expect(config.artifacts.runId).toBe("run-alpha-beta");
    expect(config.control).toEqual({
      retryCount: 4,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 4000,
    });

    const publicJson = JSON.stringify(publicJiraMigratorConfig(config));
    expect(publicJson).not.toContain("akb-secret-token");
    expect(publicJson).not.toContain("jira-secret-token");
    expect(publicJson).not.toContain("/private/policies");
  });

  it("requires the reviewed dry-run plan hash for apply and validates resume identity", () => {
    expect(() =>
      loadJiraMigratorConfig({
        argv: ["--apply"],
        env,
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "--expected-plan-sha256 is required with --apply",
        ]),
      }),
    );

    const hash = "a".repeat(64);
    const config = loadJiraMigratorConfig({
      argv: ["--apply", "--expected-plan-sha256", hash, "--resume", "run-123"],
      env,
    });
    expect(config.mode).toBe("apply");
    expect(config.expectedPlanSha256).toBe(hash);
    expect(config.resumeRunId).toBe("run-123");
    expect(config.artifacts.runId).toBe("run-123");
  });

  it("recovers the apply run identity from the sealed approval report", () => {
    const directory = mkdtempSync(join(tmpdir(), "reef-jira-config-"));
    chmodSync(directory, 0o700);
    const reportPath = join(directory, "report.json");
    writeFileSync(
      `${reportPath}.approval.json`,
      JSON.stringify({ run: { run_id: "sealed-run", mode: "dry-run" } }),
      { mode: 0o600 },
    );
    try {
      const config = loadJiraMigratorConfig({
        argv: [
          "--apply",
          "--expected-plan-sha256",
          "a".repeat(64),
          "--report-path",
          reportPath,
        ],
        env,
      });
      expect(config.artifacts.runId).toBe("sealed-run");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
