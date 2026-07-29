import { describe, expect, it } from "vitest";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import type { JiraPlanningAction } from "../planning/entities.js";
import {
  baseIssueReadbackMatches,
  completedIssueReadbackMatches,
  fingerprintJiraApprovalPlan,
  issueReadbackRepresentation,
  planningResolutionsForApproval,
  semanticIssuePlan,
} from "./approval.js";

const plan = (at: string, fields: unknown[]) => ({
  source: { fields },
  issues: [
    {
      source: {
        fieldCatalog: {
          retrievedAt: at,
          source: "jira_field_api",
        },
      },
      desired: {
        issue: {
          id: "NOTEBOOKLM-001",
          title: "미터링 기능",
          created_at: at,
          updated_at: at,
        },
      },
    },
  ],
  related_mapping: {
    accounts: {
      "jira-account": {
        actor: "김영로",
        firstSeenAt: "2026-07-27T00:00:00.000Z",
        lastSeenAt: at,
      },
    },
  },
});

describe("semanticIssuePlan", () => {
  it("normalizes target planning ids in issue fields and compact provenance", () => {
    const sourceIdentity = {
      kind: "version" as const,
      jiraCloudId: "cloud-1",
      projectId: "project-1",
      versionId: "version-1",
      key: "version:cloud-1:project-1:version-1",
    };
    const action = {
      classification: "reuse" as const,
      sourceIdentity,
      target: {
        kind: "release" as const,
        item: { name: "Release 1" },
      },
      targetId: "target-release-uuid",
    } as unknown as JiraPlanningAction;
    const approvalResolution = planningResolutionsForApproval([action])[0];
    const liveResolution = {
      sourceIdentity,
      targetKind: "release" as const,
      targetId: "target-release-uuid",
    };
    const issuePlan = (targetId: string) =>
      ({
        source: { issueKey: "ALPHA-1" },
        desired: {
          issue: {
            id: "REEF-001",
            release_id: targetId,
            sprint_id: null,
            custom_fields: {
              jira: {
                planning: [
                  {
                    kind: "version",
                    source_key: sourceIdentity.key,
                    target_id: targetId,
                  },
                ],
              },
            },
          },
          content: "",
        },
        deferred: [],
        field_results: [],
        status: "ready",
      }) as unknown as JiraIssueImportPlan;

    expect(approvalResolution).toBeDefined();
    const approved = semanticIssuePlan(
      issuePlan(approvalResolution?.targetId ?? ""),
      approvalResolution ? [approvalResolution] : [],
      [action],
    );
    const live = semanticIssuePlan(
      issuePlan(liveResolution.targetId),
      [liveResolution],
      [action],
    );

    expect(live).toEqual(approved);
  });
});

describe("fingerprintJiraApprovalPlan", () => {
  it("ignores retrieval metadata and Jira field ordering", () => {
    const fields = [
      { id: "customfield_2", name: "Second" },
      { id: "customfield_1", name: "First" },
    ];
    const approved = plan("2026-07-27T00:00:00.000Z", fields);
    const apply = plan("2026-07-27T01:00:00.000Z", [...fields].reverse());

    expect(fingerprintJiraApprovalPlan(apply)).toBe(
      fingerprintJiraApprovalPlan(approved),
    );
  });

  it("still detects a mapped issue change", () => {
    const approved = plan("2026-07-27T00:00:00.000Z", []);
    const changed = structuredClone(approved);
    changed.issues[0].desired.issue.title = "변경된 제목";

    expect(fingerprintJiraApprovalPlan(changed)).not.toBe(
      fingerprintJiraApprovalPlan(approved),
    );
  });

  it("ignores opaque pagination cursors and raw archive run ids", () => {
    const approved = {
      source: {
        fields: [],
        issue_pages: {
          ALPHA: [
            {
              nextPageToken: "opaque-approved",
              issues: [{ id: "1", key: "ALPHA-1" }],
            },
          ],
        },
      },
      issues: [],
      related_mapping: { accounts: {} },
      changelog: [
        {
          rawArchiveReference: {
            runId: "approval-run",
            entryId: "entry-1",
            contentSha256: "content-1",
          },
        },
      ],
    };
    const apply = structuredClone(approved);
    apply.source.issue_pages.ALPHA[0].nextPageToken = "opaque-apply";
    apply.changelog[0].rawArchiveReference.runId = "apply-run";

    expect(fingerprintJiraApprovalPlan(apply)).toBe(
      fingerprintJiraApprovalPlan(approved),
    );
  });

  it("ignores volatile Jira development summary values identified by schema", () => {
    const base = plan("2026-07-27T00:00:00.000Z", [
      {
        id: "customfield_dev",
        name: "development",
        schema: {
          custom:
            "com.atlassian.jira.plugins.jira-development-integration-plugin:devsummarycf",
          type: "any",
        },
      },
    ]);
    const approved = {
      ...base,
      source: {
        ...base.source,
        issue_pages: {
          ALPHA: [
            {
              issues: [
                {
                  id: "1",
                  fields: { customfield_dev: "volatile-approved-value" },
                },
              ],
            },
          ],
        },
      },
    };
    const apply = structuredClone(approved);
    apply.source.issue_pages.ALPHA[0].issues[0].fields.customfield_dev =
      "volatile-apply-value";

    expect(fingerprintJiraApprovalPlan(apply)).toBe(
      fingerprintJiraApprovalPlan(approved),
    );
  });

  it("treats an absent target labels array as an empty desired array", () => {
    const issue = {
      id: "NOTEBOOKLM-001",
      title: "미터링 기능",
      source: "jira-migration",
      labels: [],
      custom_fields: {
        jira_migration: {
          owner: {
            jira_cloud_id: "cloud-1",
            issue_id: "1",
          },
        },
      },
    };
    const issuePlan = {
      desired: { issue, content: "" },
    } as unknown as JiraIssueImportPlan;

    expect(
      baseIssueReadbackMatches(issuePlan, {
        issue: { ...issue, labels: undefined },
        content: "",
        path: "issues/notebooklm-001.md",
        commit_hash: "commit",
      } as never),
    ).toBe(true);
  });

  it("recovers an approved semantic planning token after apply resolves the target UUID", () => {
    const owner = {
      jira_cloud_id: "cloud-1",
      project_key: "ALPHA",
      issue_id: "1",
      issue_key: "ALPHA-1",
    };
    const issuePlan = (targetId: string, title = "Migrated") =>
      ({
        source: { issueKey: "ALPHA-1" },
        desired: {
          issue: {
            id: "REEF-001",
            title,
            source: "jira-migration",
            release_id: targetId,
            custom_fields: {
              jira: {
                planning: [{ kind: "version", target_id: targetId }],
              },
              jira_migration: { owner },
            },
          },
          content: "",
        },
      }) as unknown as JiraIssueImportPlan;
    const approved = issuePlan("jira-planning:release:release 1");
    const current = issuePlan("target-release-uuid");
    const readback = {
      issue: approved.desired.issue,
      content: "",
      path: "issues/reef-001.md",
      commit_hash: "commit",
    } as never;

    expect(baseIssueReadbackMatches(current, readback)).toBe(false);
    expect(completedIssueReadbackMatches(current, approved, readback)).toBe(
      true,
    );
    expect(issueReadbackRepresentation(current, approved, readback)).toBe(
      "approved",
    );
    expect(
      completedIssueReadbackMatches(
        issuePlan("target-release-uuid", "Changed"),
        issuePlan("jira-planning:release:release 1", "Changed"),
        readback,
      ),
    ).toBe(false);
  });
});
