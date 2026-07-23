import { chmod, mkdir, mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type JiraMigrationReportError,
  buildJiraRunnerReport,
  loadJiraRunnerReport,
  writeJiraRunnerReport,
} from "./report.js";

let directory: string | null = null;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = null;
});

const reportInput = () =>
  ({
    runId: "run-1",
    mode: "dry-run" as const,
    source: {
      jira_cloud_id: "cloud-1",
      project_keys: ["ALPHA", "BETA"],
      board_ids: ["7", "42"],
    },
    target: { vault: "reef-test", actor: "operator" },
    planSha256: "a".repeat(64),
    startedAt: "2026-07-23T00:00:00.000Z",
    endedAt: "2026-07-23T00:01:00.000Z",
    status: "completed",
    sections: {
      planning: [],
      issues: [],
      related: [],
      changelog: [],
      reconciliation: [],
      raw_archive: [],
    },
    terminalClassifications: [
      { phase: "issues", source_key: "issue:cloud-1:1:1", action: "create" },
      { phase: "issues", source_key: "issue:cloud-1:2:2", action: "skip" },
    ],
    inputCount: 2,
  }) satisfies Parameters<typeof buildJiraRunnerReport>[0];

const report = () => buildJiraRunnerReport(reportInput());

describe("Jira runner report", () => {
  it("enforces conservation and rejects non-terminal or duplicate inputs", () => {
    expect(report().conservation).toEqual({
      input_count: 2,
      terminal_count: 2,
      balanced: true,
    });
    expect(() =>
      buildJiraRunnerReport({
        ...report(),
        planSha256: "a".repeat(64),
        terminalClassifications: [
          {
            phase: "issues",
            source_key: "issue:cloud-1:1:1",
            action: "create",
          },
        ],
        inputCount: 2,
      } as never),
    ).toThrowError(
      expect.objectContaining({ code: "report_conservation_failed" }),
    );
  });

  it("counts failed entities marked retryable", () => {
    const retryable = buildJiraRunnerReport({
      ...reportInput(),
      terminalClassifications: [
        {
          phase: "issues",
          source_key: "issue:cloud-1:1:1",
          action: "failed",
          retryable: true,
        },
        {
          phase: "issues",
          source_key: "issue:cloud-1:2:2",
          action: "skip",
        },
      ],
      inputCount: 2,
    });
    expect(retryable.totals).toMatchObject({
      failed: 1,
      retryable: 1,
    });
  });

  it("writes a private atomic report and rejects secret canaries", async () => {
    directory = await mkdtemp(join(tmpdir(), "reef-jira-report-"));
    await chmod(directory, 0o700);
    const path = join(directory, "report.json");
    await writeJiraRunnerReport({
      path,
      report: report(),
      forbiddenSecretValues: ["jira-canary", "akb-canary"],
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(report());
    expect(await loadJiraRunnerReport(path)).toEqual(report());

    await mkdir(`${path}.lock`);
    const staleAt = new Date(Date.now() - 60_000);
    await utimes(`${path}.lock`, staleAt, staleAt);
    expect(await loadJiraRunnerReport(path)).toEqual(report());

    await expect(
      writeJiraRunnerReport({
        path,
        report: {
          ...report(),
          sections: { ...report().sections, issues: ["jira-canary"] },
        },
        expectedReport: report(),
        forbiddenSecretValues: ["jira-canary"],
      }),
    ).rejects.toMatchObject({
      code: "secret_material_detected",
    } satisfies Partial<JiraMigrationReportError>);

    const escapedSecret = 'jira-"canary\\line\nbreak';
    await expect(
      writeJiraRunnerReport({
        path,
        report: {
          ...report(),
          sections: { ...report().sections, issues: [escapedSecret] },
        },
        expectedReport: report(),
        forbiddenSecretValues: [escapedSecret],
      }),
    ).rejects.toMatchObject({
      code: "secret_material_detected",
    } satisfies Partial<JiraMigrationReportError>);
  });
});
