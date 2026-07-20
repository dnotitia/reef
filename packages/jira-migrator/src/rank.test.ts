import { describe, expect, it } from "vitest";
import { applyJiraRankImportPlan, buildJiraRankImportPlan } from "./rank";

describe("buildJiraRankImportPlan", () => {
  it("maps Jira Rank into reef rank and preserves the source rank in provenance", () => {
    const plans = buildJiraRankImportPlan([
      { reefId: "REEF-2", jiraKey: "ALPHA-2", jiraRank: "0|i00020:" },
      { reefId: "REEF-1", jiraKey: "ALPHA-1", jiraRank: "0|i00010:" },
    ]);

    expect(plans[0]).toMatchObject({
      reefId: "REEF-2",
      jiraKey: "ALPHA-2",
      rank: 2000,
      reportClassification: "rank_mapped",
      provenance: {
        source: "jira",
        field: "Rank",
        value: "0|i00020:",
      },
      issueFields: {
        rank: 2000,
        custom_fields: {
          jira: {
            key: "ALPHA-2",
            rank: "0|i00020:",
            rank_mapping: {
              classification: "rank_mapped",
              rank: 2000,
            },
          },
        },
      },
    });
    expect(plans[1].rank).toBe(1000);
  });

  it("reports unmapped Jira Rank values without writing a reef rank", () => {
    const plans = buildJiraRankImportPlan([
      { reefId: "REEF-1", jiraKey: "ALPHA-1", jiraRank: "0|same:" },
      { reefId: "REEF-2", jiraKey: "ALPHA-2", jiraRank: "0|same:" },
      { reefId: "REEF-3", jiraKey: "ALPHA-3", jiraRank: null },
    ]);

    expect(plans.map((p) => p.reportClassification)).toEqual([
      "rank_unmapped",
      "rank_unmapped",
      "rank_unmapped",
    ]);
    expect(plans[0].reportReason).toBe("duplicate_jira_rank");
    expect(plans[2].reportReason).toBe("missing_jira_rank");
    expect(plans[0].issueFields).not.toHaveProperty("rank");
    expect(plans[2].issueFields.custom_fields).toMatchObject({
      jira: {
        key: "ALPHA-3",
        rank: null,
        rank_mapping: {
          classification: "rank_unmapped",
          reason: "missing_jira_rank",
        },
      },
    });
  });
});

describe("applyJiraRankImportPlan", () => {
  it("merges Jira Rank provenance into existing issue custom fields", () => {
    const [plan] = buildJiraRankImportPlan([
      { reefId: "REEF-1", jiraKey: "ALPHA-1", jiraRank: "0|i00010:" },
    ]);
    const issue = applyJiraRankImportPlan(
      {
        id: "REEF-1",
        title: "Imported issue",
        status: "todo",
        issue_type: "task",
        created_at: "2026-07-09T00:00:00.000Z",
        created_by: "importer",
        updated_at: "2026-07-09T00:00:00.000Z",
        updated_by: "importer",
        custom_fields: { jira: { status: "해야 할 일" }, keep: true },
      },
      plan,
    );

    expect(issue.rank).toBe(1000);
    expect(issue.custom_fields).toMatchObject({
      keep: true,
      jira: {
        status: "해야 할 일",
        key: "ALPHA-1",
        rank: "0|i00010:",
        rank_mapping: {
          classification: "rank_mapped",
          rank: 1000,
        },
      },
    });
  });

  it("keeps an existing reef rank untouched when the Jira Rank plan is unmapped", () => {
    const [plan] = buildJiraRankImportPlan([
      { reefId: "REEF-1", jiraKey: "ALPHA-1", jiraRank: null },
    ]);
    const issue = applyJiraRankImportPlan(
      {
        id: "REEF-1",
        title: "Imported issue",
        status: "todo",
        issue_type: "task",
        rank: 4000,
        created_at: "2026-07-09T00:00:00.000Z",
        created_by: "importer",
        updated_at: "2026-07-09T00:00:00.000Z",
        updated_by: "importer",
      },
      plan,
    );

    expect(issue.rank).toBe(4000);
    expect(issue.custom_fields).toMatchObject({
      jira: {
        key: "ALPHA-1",
        rank: null,
        rank_mapping: {
          classification: "rank_unmapped",
          reason: "missing_jira_rank",
        },
      },
    });
  });
});
