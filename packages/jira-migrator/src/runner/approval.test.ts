import { describe, expect, it } from "vitest";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import {
  baseIssueReadbackMatches,
  fingerprintJiraApprovalPlan,
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
});
