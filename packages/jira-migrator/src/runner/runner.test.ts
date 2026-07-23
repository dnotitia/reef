import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JiraMigratorConfig, NormalizedJiraIssue } from "../index.js";
import { jiraIssueFixture } from "../jira/fixtures.js";
import { JiraIssueSchema, normalizeJiraIssue } from "../payloads.js";
import { runJiraMigration } from "./runner.js";

let root: string | null = null;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

const makeIssue = (
  projectKey: string,
  projectId: string,
  issueId: string,
): NormalizedJiraIssue =>
  normalizeJiraIssue(
    JiraIssueSchema.parse({
      ...jiraIssueFixture,
      id: issueId,
      key: `${projectKey}-1`,
      fields: {
        ...jiraIssueFixture.fields,
        project: {
          ...jiraIssueFixture.fields.project,
          id: projectId,
          key: projectKey,
          name: projectKey,
        },
        attachment: [],
        issuelinks: [],
      },
    }),
  );

const policy = {
  statuses: [{ name: "In Progress", status: "in_progress" }],
  issueTypes: [{ name: "Task", issueType: "task" }],
  priorities: [],
};

describe("runJiraMigration", () => {
  it("runs dry-run then approved apply with the same plan and zero dry-run mutation", async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "reef-jira-runner-")));
    await chmod(root, 0o700);
    const policyPaths: Record<string, string> = {};
    for (const key of ["ALPHA", "BETA"]) {
      const path = join(root, `${key}.policy.json`);
      await writeFile(path, JSON.stringify(policy), { mode: 0o600 });
      policyPaths[key] = path;
    }
    const artifactRoot = join(root, "artifacts");
    await chmod(root, 0o700);
    const config: JiraMigratorConfig = {
      mode: "dry-run",
      dryRun: true,
      jira: {
        baseUrl: "https://jira.test",
        cloudId: "cloud-1",
        projectKey: "ALPHA",
        projectKeys: ["ALPHA", "BETA"],
        boardIds: [],
        mappingPolicyPaths: policyPaths,
        auth: { mode: "bearer", token: "jira-canary" },
      },
      target: {
        baseUrl: "https://akb.test",
        vault: "reef-test",
        jwt: "akb-canary",
      },
      targetVault: "reef-test",
      reportPath: join(artifactRoot, "report.json"),
      accountMappingPath: join(artifactRoot, "accounts.json"),
      artifacts: {
        runId: "run-alpha-beta",
        ledgerPath: join(artifactRoot, "ledger.json"),
        archiveRoot: join(artifactRoot, "archive"),
        accountMappingPath: join(artifactRoot, "accounts.json"),
        reportPath: join(artifactRoot, "report.json"),
      },
      resumeRunId: null,
      expectedPlanSha256: null,
      control: {
        retryCount: 0,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
      },
    };
    const issues = {
      ALPHA: makeIssue("ALPHA", "100", "10001"),
      BETA: makeIssue("BETA", "200", "20001"),
    };
    const clients = new Map(
      Object.entries(issues).map(([key, issue]) => [
        key,
        {
          listFields: vi.fn(async () => ({
            items: [],
            rateLimit: {},
            raw: [],
          })),
          readBoardSprintCatalog: vi.fn(),
          readProjectVersionCatalog: vi.fn(async () => ({
            items: [],
            pages: [],
            rateLimits: [],
          })),
          listChangelog: vi.fn(async () => ({
            items: [],
            cursor: null,
            isLast: true,
            rateLimit: {},
            raw: { values: [], isLast: true },
          })),
          readComments: vi.fn(async () => ({
            items: [],
            cursor: null,
            isLast: true,
            rateLimit: {},
            raw: { comments: [] },
          })),
          listRemoteLinks: vi.fn(async () => ({
            items: [],
            rateLimit: {},
            raw: [],
          })),
          searchProjectIssues: vi.fn(async () => ({
            items: [issue],
            cursor: null,
            isLast: true,
            rateLimit: {},
            raw: { issues: [issue.raw], isLast: true },
          })),
        },
      ]),
    );
    const mutations: string[] = [];
    const writtenIssues = new Map<
      string,
      { issue: Record<string, unknown>; content: string }
    >();
    const target = {
      adapter: { request: vi.fn() },
      preflight: vi.fn(async () => ({
        actor: "operator",
        vault: "reef-test",
        planning: { releases: [], sprints: [], milestones: [] },
      })),
      planIssueIds: vi.fn(async () => ["REEF-001", "REEF-002"]),
      applyPlanning: vi.fn(),
      applyIssue: vi.fn(async (plan) => {
        if (writtenIssues.has(plan.desired.issue.id)) {
          throw new Error("target_issue_already_exists");
        }
        mutations.push(plan.desired.issue.id);
        writtenIssues.set(plan.desired.issue.id, {
          issue: plan.desired.issue,
          content: plan.desired.content,
        });
        return {
          reefId: plan.desired.issue.id,
          documentUri: `akb://reef-test/coll/issues/doc/${plan.desired.issue.id.toLowerCase()}.md`,
          commitHash: "commit",
        };
      }),
      readIssue: vi.fn(async (id) => {
        const written = writtenIssues.get(id);
        if (!written) throw new Error("issue_missing");
        return { ...written, commit_hash: "commit" };
      }),
      claimIssue: vi.fn(),
      relatedTarget: vi.fn(() => ({})),
      appendActivity: vi.fn(),
    } as never;
    const times = [
      "2026-07-23T00:00:00.000Z",
      "2026-07-23T00:01:00.000Z",
      "2026-07-23T00:02:00.000Z",
      "2026-07-23T00:03:00.000Z",
      "2026-07-23T00:04:00.000Z",
      "2026-07-23T00:05:00.000Z",
      "2026-07-23T00:06:00.000Z",
      "2026-07-23T00:07:00.000Z",
    ];
    const now = () => times.shift() ?? "2026-07-23T00:08:00.000Z";
    const dryRun = await runJiraMigration(config, {
      target,
      createJiraClient: (key) => clients.get(key) as never,
      now,
    });
    expect(mutations).toEqual([]);
    expect(dryRun.report.conservation.balanced).toBe(true);
    expect(dryRun.report.run.status).toBe("completed");
    expect(JSON.stringify(dryRun.report)).not.toMatch(
      /jira-canary|akb-canary|operator@example\.com/u,
    );

    const applyConfig = {
      ...config,
      mode: "apply" as const,
      dryRun: false,
      expectedPlanSha256: dryRun.planSha256,
    };
    await expect(
      runJiraMigration(applyConfig, {
        target,
        createJiraClient: (key) => clients.get(key) as never,
        now,
        failAfterConfirmedEntities: 1,
      }),
    ).rejects.toMatchObject({ code: "failpoint" });
    expect(mutations).toEqual(["REEF-001"]);

    const apply = await runJiraMigration(applyConfig, {
      target,
      createJiraClient: (key) => clients.get(key) as never,
      now,
    });
    expect(apply.planSha256).toBe(dryRun.planSha256);
    expect(mutations).toEqual(["REEF-001", "REEF-002"]);
    expect(apply.report.totals.created).toBe(1);
    expect(apply.report.totals.skipped).toBe(1);

    const rerun = await runJiraMigration(applyConfig, {
      target,
      createJiraClient: (key) => clients.get(key) as never,
      now,
    });
    expect(mutations).toEqual(["REEF-001", "REEF-002"]);
    expect(rerun.report.totals.created).toBe(0);
    expect(rerun.report.totals.skipped).toBe(2);
  });
});
