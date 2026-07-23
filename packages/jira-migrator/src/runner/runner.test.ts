import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JiraMigratorConfig, NormalizedJiraIssue } from "../index.js";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import { jiraIssueFixture } from "../jira/fixtures.js";
import { JiraIssueSchema, normalizeJiraIssue } from "../payloads.js";
import { reportTemplate } from "../related/reporting.js";
import {
  actionForRelatedReport,
  baseIssueReadbackMatches,
  canRecoverApprovedPlanningCreate,
  inferRelationSourceProjectKey,
  issueReadbackApprovalFingerprint,
  runJiraMigration,
} from "./runner.js";

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
  it("reports planned related writes as creates", () => {
    const report = reportTemplate("dry-run");
    report.comments.created = 1;
    expect(actionForRelatedReport(report)).toBe("create");
    report.failures.push({
      source_kind: "comment",
      source_id: "1",
      phase: "write",
      reason: "failed",
      retryable: false,
    });
    expect(actionForRelatedReport(report)).toBe("failed");
  });

  it("accepts a verified post-related description rewrite on rerun", () => {
    const issue = {
      id: "REEF-001",
      title: "Migrated",
      status: "todo",
      created_at: "2026-07-23T00:00:00.000Z",
      created_by: "operator",
      updated_at: "2026-07-23T00:00:00.000Z",
      updated_by: "operator",
      source: "jira-migration",
      custom_fields: {
        jira_migration: {
          owner: {
            jira_cloud_id: "cloud-1",
            project_key: "ALPHA",
            issue_id: "10001",
            issue_key: "ALPHA-1",
          },
        },
      },
    };
    const plan = {
      desired: { issue, content: "pre-rewrite markdown" },
    } as unknown as JiraIssueImportPlan;
    const readback = {
      issue,
      content: "markdown with akb://reef-test/file/attachment",
      path: "issues/reef-001.md",
      commit_hash: "commit",
    } as never;

    expect(baseIssueReadbackMatches(plan, readback)).toBe(false);
    expect(
      baseIssueReadbackMatches(
        plan,
        readback,
        "markdown with akb://reef-test/file/attachment",
      ),
    ).toBe(true);
  });

  it("fingerprints approval-time mapped target drift", () => {
    const issue = {
      id: "REEF-001",
      title: "Migrated",
      status: "todo",
      created_at: "2026-07-23T00:00:00.000Z",
      created_by: "operator",
      updated_at: "2026-07-23T00:00:00.000Z",
      updated_by: "operator",
      source: "jira-migration",
      custom_fields: {
        jira_migration: {
          owner: {
            jira_cloud_id: "cloud-1",
            project_key: "ALPHA",
            issue_id: "10001",
            issue_key: "ALPHA-1",
          },
        },
      },
    };
    const plan = {
      source: { issueKey: "ALPHA-1" },
      desired: { issue, content: "body" },
    } as unknown as JiraIssueImportPlan;
    const approved = {
      issue,
      content: "body",
      path: "issues/reef-001.md",
      commit_hash: "commit",
    };
    const drifted = {
      ...approved,
      issue: { ...issue, title: "Independent target edit" },
    };

    expect(issueReadbackApprovalFingerprint(plan, approved as never)).not.toBe(
      issueReadbackApprovalFingerprint(plan, drifted as never),
    );
  });

  it("does not adopt an unowned exact-name planning entity after approval", () => {
    expect(
      canRecoverApprovedPlanningCreate(
        {
          classification: "reuse",
          reason: "compatible_exact_name",
          sourceIdentity: {
            kind: "version",
            jiraCloudId: "cloud-1",
            projectId: "100",
            versionId: "70001",
            key: "version:cloud-1:100:70001",
          },
        } as never,
        { bindings: [] } as never,
      ),
    ).toBe(false);
  });

  it("infers a legacy relation project from its persisted issue identity", () => {
    const issueBinding = {
      source_key: "issue:cloud-1:100:10001",
      source_identity: {
        entity_kind: "issue",
        jira_cloud_id: "cloud-1",
        project_id: "100",
        issue_id: "10001",
        key: "issue:cloud-1:100:10001",
      },
      source_fingerprint: "source",
      mapped_state_fingerprint: "mapped",
      target: {
        target_kind: "issue",
        reef_id: "REEF-001",
        document_uri: "akb://reef-test/coll/issues/doc/reef-001.md",
      },
      confirmed_at: "2026-07-23T00:00:00.000Z",
    };
    const relationBinding = {
      source_key: "relation:cloud-1:10001:20001:blocks:outward:42",
      source_identity: {
        entity_kind: "relation",
        jira_cloud_id: "cloud-1",
        source_issue_id: "10001",
        target_issue_id: "20001",
        link_type: "blocks",
        direction: "outward",
        link_id: "42",
        key: "relation:cloud-1:10001:20001:blocks:outward:42",
      },
      source_fingerprint: "source",
      mapped_state_fingerprint: "mapped",
      target: {
        target_kind: "relation",
        idempotency_key: "relation:cloud-1:42",
      },
      confirmed_at: "2026-07-23T00:00:00.000Z",
    };
    expect(
      inferRelationSourceProjectKey({
        binding: relationBinding as never,
        ledger: {
          version: 1,
          scope: {
            jira_cloud_id: "cloud-1",
            target_vault: "reef-test",
          },
          runs: [],
          bindings: [issueBinding, relationBinding],
        } as never,
        currentIssues: [],
        configuredProjectKeys: ["ALPHA"],
        projectKeyById: new Map([["100", "ALPHA"]]),
      }),
    ).toBe("ALPHA");
  });

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
        commentCatalogComplete: false,
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
          getProject: vi.fn(async () => ({
            project: { id: issue.raw.fields.project?.id ?? key, key },
            rateLimit: {},
            raw: { id: issue.raw.fields.project?.id ?? key, key },
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
    const readIssue = vi.fn(async (id: string) => {
      const written = writtenIssues.get(id);
      if (!written) throw new Error("issue_missing");
      return { ...written, commit_hash: "commit" };
    });
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
      readIssue,
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
    await expect(
      runJiraMigration(
        { ...config, mode: "apply", dryRun: false },
        {
          target,
          createJiraClient: (key) => clients.get(key) as never,
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "dry_run_approval_required" });
    expect(mutations).toEqual([]);

    await expect(
      runJiraMigration(
        {
          ...config,
          artifacts: {
            ...config.artifacts,
            ledgerPath: config.artifacts.reportPath,
          },
        },
        {
          target,
          createJiraClient: (key) => clients.get(key) as never,
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "artifact_paths_required" });
    await expect(
      runJiraMigration(
        {
          ...config,
          artifacts: {
            ...config.artifacts,
            archiveRoot: `${config.artifacts.ledgerPath}.run.lock`,
          },
        },
        {
          target,
          createJiraClient: (key) => clients.get(key) as never,
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "artifact_paths_required" });

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
    const repeatedDryRun = await runJiraMigration(config, {
      target,
      createJiraClient: (key) => clients.get(key) as never,
      now,
    });
    expect(repeatedDryRun.planSha256).toBe(dryRun.planSha256);
    expect(mutations).toEqual([]);

    const applyConfig = {
      ...config,
      mode: "apply" as const,
      dryRun: false,
      expectedPlanSha256: dryRun.planSha256,
    };
    const approvalPath = `${config.artifacts.reportPath}.approval.json`;
    const approvalBytes = await readFile(approvalPath);
    const editedApproval = JSON.parse(approvalBytes.toString("utf8"));
    editedApproval.totals.created += 1;
    await writeFile(approvalPath, JSON.stringify(editedApproval), {
      mode: 0o600,
    });
    await expect(
      runJiraMigration(applyConfig, {
        target,
        createJiraClient: (key) => clients.get(key) as never,
        now,
      }),
    ).rejects.toMatchObject({ code: "plan_fingerprint_mismatch" });
    expect(mutations).toEqual([]);
    await writeFile(approvalPath, approvalBytes, { mode: 0o600 });

    await expect(
      runJiraMigration(
        {
          ...applyConfig,
          control: {
            ...applyConfig.control,
            commentCatalogComplete: true,
          },
        },
        {
          target,
          createJiraClient: (key) => clients.get(key) as never,
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "plan_fingerprint_mismatch" });
    expect(mutations).toEqual([]);

    await expect(
      runJiraMigration(
        {
          ...applyConfig,
          target: {
            ...applyConfig.target,
            baseUrl: "https://different-akb.test",
          },
        },
        {
          target,
          createJiraClient: (key) => clients.get(key) as never,
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "dry_run_scope_mismatch" });
    expect(mutations).toEqual([]);

    await expect(
      runJiraMigration(
        {
          ...applyConfig,
          jira: {
            ...applyConfig.jira,
            baseUrl: "https://different-jira.test",
          },
        },
        {
          target,
          createJiraClient: (key) => clients.get(key) as never,
          now,
        },
      ),
    ).rejects.toMatchObject({ code: "dry_run_scope_mismatch" });
    expect(mutations).toEqual([]);

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

    for (const [id, written] of writtenIssues) {
      const customFields =
        written.issue.custom_fields &&
        typeof written.issue.custom_fields === "object" &&
        !Array.isArray(written.issue.custom_fields)
          ? (written.issue.custom_fields as Record<string, unknown>)
          : {};
      writtenIssues.set(id, {
        ...written,
        issue: {
          ...written.issue,
          custom_fields: {
            ...customFields,
            target_authored: { keep: true },
          },
        },
      });
    }
    const rerun = await runJiraMigration(applyConfig, {
      target,
      createJiraClient: (key) => clients.get(key) as never,
      now,
    });
    expect(mutations).toEqual(["REEF-001", "REEF-002"]);
    expect(rerun.report.totals.created).toBe(0);
    expect(rerun.report.totals.skipped).toBe(2);

    const alpha = writtenIssues.get("REEF-001");
    if (!alpha) throw new Error("alpha_issue_missing");
    writtenIssues.set("REEF-001", {
      ...alpha,
      issue: { ...alpha.issue, title: "Target-authored drift" },
    });
    const readCallsBeforeDriftCheck = readIssue.mock.calls.length;
    const driftedDryRun = await runJiraMigration(config, {
      target,
      createJiraClient: (key) => clients.get(key) as never,
      now,
    });
    expect(readIssue.mock.calls.length).toBeGreaterThan(
      readCallsBeforeDriftCheck,
    );
    expect(driftedDryRun.report.run.status).toBe("blocked");
    expect(driftedDryRun.report.terminal_classifications).toContainEqual(
      expect.objectContaining({
        phase: "issues",
        source_key: "issue:cloud-1:100:10001",
        action: "conflict",
      }),
    );
  });
});
