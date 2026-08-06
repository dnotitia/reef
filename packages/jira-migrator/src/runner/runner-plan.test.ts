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
import { mappedFingerprintForIssue } from "./decisions.js";
import { scheduleIssuePlansForApply } from "./issueSchedule.js";
import {
  actionForRelatedIssuePlan,
  assertRelatedOperationSubset,
  relatedPlanForApproval,
} from "./plan.js";
import {
  actionForRelatedReport,
  baseIssueReadbackMatches,
  canRecoverApprovedPlanningCreate,
  inferRelationSourceProjectKey,
  issueReadbackApprovalFingerprint,
  migrationScopeLockIdentity,
  runJiraMigration,
} from "./runner.js";
import { JiraTargetConflictError } from "./targetAdapter.js";

let root: string | null = null;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

const makeIssue = (
  projectKey: string,
  projectId: string,
  issueId: string,
  rank: string,
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
        customfield_rank: rank,
        issuelinks: [],
      },
    }),
  );

const policy = {
  statuses: [{ name: "In Progress", status: "in_progress" }],
  issueTypes: [{ name: "Task", issueType: "task" }],
  priorities: [],
  fieldOverrides: {
    story_points: "customfield_story_points",
    start_date: "customfield_start_date",
  },
};
describe("runJiraMigration", () => {
  it("schedules referenced issue creates first and blocks dependency cycles", () => {
    const issuePlan = (id: string, parentId?: string) =>
      ({
        desired: {
          issue: {
            id,
            parent_id: parentId ?? null,
            depends_on: [],
            blocks: [],
            related_to: [],
          },
        },
      }) as unknown as JiraIssueImportPlan;
    const parent = issuePlan("REEF-001");
    const child = issuePlan("REEF-002", "REEF-001");
    const cycleA = issuePlan("REEF-003", "REEF-004");
    const cycleB = issuePlan("REEF-004", "REEF-003");

    const scheduled = scheduleIssuePlansForApply([
      child,
      cycleA,
      parent,
      cycleB,
    ]);

    expect(scheduled.plans).toEqual([parent, child, cycleA, cycleB]);
    expect([...scheduled.blockedIssueIds]).toEqual(["REEF-003", "REEF-004"]);
  });

  it("serializes different run ids over the same migration scope", () => {
    const base = {
      jira: {
        baseUrl: "https://jira.test",
        cloudId: "cloud-1",
        projectKeys: ["BETA", "ALPHA"],
      },
      target: { baseUrl: "https://akb.test", vault: "reef-test" },
      artifacts: { runId: "run-1" },
    } as JiraMigratorConfig;
    expect(migrationScopeLockIdentity(base)).toBe(
      migrationScopeLockIdentity({
        ...base,
        artifacts: { ...base.artifacts, runId: "run-2" },
      }),
    );
  });

  it("keeps the approved related plan stable after target reconciliation", () => {
    const currentReport = reportTemplate("dry-run");
    expect(
      relatedPlanForApproval(
        {
          related_plan: [
            {
              issue_key: "ALPHA-1",
              report: {
                deletions: 1,
                media: { description_updated: true },
              },
            },
          ],
        },
        [{ issue_key: "ALPHA-1", report: currentReport }],
      ),
    ).toEqual([
      {
        issue_key: "ALPHA-1",
        report: {
          deletions: 1,
          media: { description_updated: true },
        },
      },
    ]);
  });

  it("rejects a redirected related mutation while allowing completed resume operations", () => {
    const approved = [
      {
        kind: "revoke_attachment" as const,
        key_sha256: "approved-file",
        input_sha256: "approved-input",
      },
    ];
    expect(() =>
      assertRelatedOperationSubset(approved, [
        {
          ...approved[0],
          key_sha256: "redirected-file",
        },
      ]),
    ).toThrow("plan_fingerprint_mismatch");
    expect(() => assertRelatedOperationSubset(approved, [])).not.toThrow();
  });

  it("reports planned related writes as creates", () => {
    const report = reportTemplate("dry-run");
    report.comments.created = 1;
    expect(actionForRelatedReport(report)).toBe("create");
    report.comments.created = 0;
    report.operations.push({
      kind: "create_attachment",
      key_sha256: "key",
      input_sha256: "input",
    });
    expect(actionForRelatedReport(report)).toBe("create");
    report.operations = [];
    report.comments.updated = 1;
    expect(actionForRelatedReport(report)).toBe("update");
    report.comments.updated = 0;
    report.deletions = 1;
    expect(actionForRelatedReport(report)).toBe("update");
    report.deletions = 0;
    report.media.description_updated = true;
    expect(actionForRelatedReport(report)).toBe("update");
    report.media.description_updated = false;
    report.operations.push({
      kind: "delete_relation",
      key_sha256: "key",
      input_sha256: "input",
    });
    expect(actionForRelatedReport(report)).toBe("update");
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

  it("plans related data from converged target content after a stale issue fingerprint", () => {
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
      source: {
        jiraCloudId: "cloud-1",
        projectId: "100",
        projectKey: "ALPHA",
        issueId: "10001",
        issueKey: "ALPHA-1",
      },
      status: "ready",
      desired: { issue, content: "pre-rewrite markdown" },
    } as unknown as JiraIssueImportPlan;
    const ledger = {
      bindings: [
        {
          source_key: "issue:cloud-1:100:10001",
          target: { target_kind: "issue", reef_id: "REEF-001" },
          mapped_state_fingerprint: "stale",
        },
      ],
    } as never;
    const readback = {
      issue,
      content: "markdown with akb://reef-test/file/attachment",
      path: "issues/reef-001.md",
      commit_hash: "commit",
    } as never;

    expect(
      actionForRelatedIssuePlan({
        plan,
        equivalentPlans: [],
        ledger,
        readback: null,
      }),
    ).toBe("update");
    expect(
      actionForRelatedIssuePlan({
        plan,
        equivalentPlans: [],
        ledger,
        readback,
        postRelatedContent: "markdown with akb://reef-test/file/attachment",
      }),
    ).toBe("skip");
  });

  it("plans a native planning normalization when readback still has the approved token", () => {
    const owner = {
      jira_cloud_id: "cloud-1",
      project_key: "ALPHA",
      issue_id: "10001",
      issue_key: "ALPHA-1",
    };
    const issuePlan = (releaseId: string) =>
      ({
        source: {
          jiraCloudId: "cloud-1",
          projectId: "100",
          projectKey: "ALPHA",
          issueId: "10001",
          issueKey: "ALPHA-1",
        },
        status: "ready",
        desired: {
          issue: {
            id: "REEF-001",
            title: "Migrated",
            status: "todo",
            source: "jira-migration",
            release_id: releaseId,
            custom_fields: {
              jira: {
                planning: [{ kind: "version", target_id: releaseId }],
              },
              jira_migration: { owner },
            },
          },
          content: "",
        },
      }) as unknown as JiraIssueImportPlan;
    const approved = issuePlan("jira-planning:release:release 1");
    const current = issuePlan("target-release-uuid");
    const ledger = {
      bindings: [
        {
          source_key: "issue:cloud-1:100:10001",
          target: { target_kind: "issue", reef_id: "REEF-001" },
          mapped_state_fingerprint: mappedFingerprintForIssue(current),
        },
      ],
    } as never;
    const readback = {
      issue: approved.desired.issue,
      content: "",
      path: "issues/reef-001.md",
      commit_hash: "commit",
    } as never;

    expect(
      actionForRelatedIssuePlan({
        plan: current,
        equivalentPlans: [approved],
        ledger,
        readback,
      }),
    ).toBe("update");
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
});
