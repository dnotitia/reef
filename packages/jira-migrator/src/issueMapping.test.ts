import { describe, expect, it } from "vitest";
import { createJiraAccountMappingArtifact } from "./accountMapping.js";
import { buildJiraFieldCatalog } from "./fieldCatalog.js";
import { projectJiraIssueEventualWrite } from "./importPlan.js";
import {
  type BuildJiraIssueImportPlanInput,
  type JiraIssueMappingPolicy,
  buildJiraIssueImportPlan,
} from "./issueMapping.js";
import { JiraIssueSchema } from "./payloads.js";
import {
  buildJiraPlanningTargetMappings,
  jiraSprintSourceIdentity,
  jiraVersionSourceIdentity,
} from "./planning.js";
import { buildJiraRankImportPlan } from "./rank.js";

const sha = "a".repeat(64);
const rawRef = (entryId: string) => ({
  runId: "run-318",
  entryId,
  contentSha256: sha,
});

const fieldCatalog = buildJiraFieldCatalog({
  retrievedAt: "2026-07-20T05:00:00.000Z",
  fields: [
    {
      id: "customfield_alpha_sprint",
      name: "Sprint",
      schema: {
        type: "array",
        items: "json",
        custom: "com.pyxis.greenhopper.jira:gh-sprint",
      },
    },
    {
      id: "customfield_alpha_points",
      name: "Story Points",
      schema: {
        type: "number",
        custom: "com.atlassian.jira.plugin.system.customfieldtypes:float",
      },
    },
    {
      id: "customfield_alpha_start",
      name: "Start date",
      schema: { type: "date", custom: "tenant:start-date" },
    },
    {
      id: "customfield_alpha_rank",
      name: "Rank",
      schema: {
        type: "string",
        custom: "com.pyxis.greenhopper.jira:gh-lexo-rank",
      },
    },
  ],
});

const policy: JiraIssueMappingPolicy = {
  statuses: [
    { id: "1", name: "To Do", status: "todo" },
    { id: "3", name: "Done", status: "closed", closedReason: "completed" },
    { categoryKey: "new", status: "todo" },
  ],
  issueTypes: [
    { id: "100", name: "Task", issueType: "task" },
    { id: "101", name: "Bug", issueType: "bug" },
  ],
  priorities: [{ id: "2", name: "High", priority: "high" }],
};

const issueFixture = JiraIssueSchema.parse({
  id: "10001",
  key: "ALPHA-1",
  self: "https://jira.example.test/rest/api/3/issue/10001?expand=names",
  fields: {
    summary: "Map this issue",
    description: {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Body" }] },
      ],
    },
    created: "2024-01-01T01:00:00.000Z",
    updated: "2024-02-01T01:00:00.000Z",
    labels: ["migration"],
    project: { id: "200", key: "ALPHA", name: "Alpha" },
    issuetype: { id: "100", name: "Task", subtask: false, hierarchyLevel: 0 },
    status: {
      id: "1",
      name: "To Do",
      statusCategory: { id: "2", key: "new", name: "To Do" },
    },
    priority: { id: "2", name: "High" },
    creator: {
      accountId: "creator-private-id",
      displayName: "Creator Name",
      emailAddress: "creator@example.test",
    },
    reporter: {
      accountId: "reporter-id",
      emailAddress: "reporter@example.test",
    },
    assignee: {
      accountId: "assignee-id",
      emailAddress: "assignee@example.test",
    },
    parent: { id: "999", key: "ALPHA-9" },
    duedate: "2026-07-21",
    fixVersions: [{ id: "10", name: "R1" }],
    customfield_alpha_sprint: [{ id: "20", name: "Sprint 1", state: "active" }],
    customfield_alpha_points: 5,
    customfield_alpha_start: "2026-07-20",
    customfield_alpha_rank: "0|i00010:",
  },
});

const versionKey = jiraVersionSourceIdentity("cloud-1", "200", "10").key;
const sprintKey = jiraSprintSourceIdentity("cloud-1", "20").key;
const planningMappings = buildJiraPlanningTargetMappings([
  {
    sourceIdentity: jiraVersionSourceIdentity("cloud-1", "200", "10"),
    targetKind: "release",
    targetId: "release-uuid",
  },
  {
    sourceIdentity: jiraSprintSourceIdentity("cloud-1", "20"),
    targetKind: "sprint",
    targetId: "sprint-uuid",
  },
]);

const makeInput = (
  overrides: Partial<BuildJiraIssueImportPlanInput> = {},
): BuildJiraIssueImportPlanInput => ({
  issue: issueFixture,
  targetReefId: "REEF-900",
  jiraCloudId: "cloud-1",
  targetVault: "reef-target",
  runAt: "2026-07-20T05:30:00.000Z",
  migrationActor: "migration-operator",
  fieldCatalog,
  policy,
  accountMapping: {
    artifact: createJiraAccountMappingArtifact({
      jiraCloudId: "cloud-1",
      overrides: {
        "creator-private-id": { actor: "reef-creator" },
        "reporter-id": { actor: "reef-reporter" },
        "assignee-id": { actor: "reef-assignee" },
      },
    }),
  },
  planningMappings,
  targetIdsByJiraKey: { "ALPHA-9": "REEF-899" },
  rankPlan: buildJiraRankImportPlan([
    { reefId: "REEF-900", jiraKey: "ALPHA-1", jiraRank: "0|i00010:" },
  ])[0],
  rawArchiveReferences: {
    issue: rawRef("issue-entry"),
    descriptionAdf: rawRef("adf-entry"),
  },
  ...overrides,
});

describe("Jira issue import planning", () => {
  it("builds a runtime-valid, immutable plan from actor/planning/parent/rank contracts", () => {
    const input = makeInput();
    const before = JSON.stringify(input);
    const first = buildJiraIssueImportPlan(input);
    const second = buildJiraIssueImportPlan(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first).toMatchObject({
      schema_version: 1,
      status: "ready",
      source: {
        projectKey: "ALPHA",
        issueKey: "ALPHA-1",
        issueUrl: "https://jira.example.test/rest/api/3/issue/10001",
      },
      desired: {
        content: "Body",
        issue: {
          id: "REEF-900",
          status: "todo",
          issue_type: "task",
          priority: "high",
          created_by: "reef-creator",
          updated_by: "migration-operator",
          assigned_to: "reef-assignee",
          reporter: "reef-reporter",
          requester: "reef-reporter",
          parent_id: "REEF-899",
          release_id: "release-uuid",
          sprint_id: "sprint-uuid",
          rank: 1000,
          estimate_points: 5,
          start_date: "2026-07-20",
          due_date: "2026-07-21",
        },
      },
    });
    expect(first.planning_associations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKey: versionKey,
          primary: true,
          targetId: "release-uuid",
        }),
        expect.objectContaining({
          sourceKey: sprintKey,
          primary: true,
          targetId: "sprint-uuid",
        }),
      ]),
    );
    expect(first.deferred).toEqual([]);
    for (const fieldId of [
      "customfield_alpha_sprint",
      "customfield_alpha_points",
      "customfield_alpha_start",
      "customfield_alpha_rank",
    ]) {
      expect(
        first.field_results.filter(
          (result) => result.sourceFieldId === fieldId,
        ),
      ).toHaveLength(1);
      expect(first.field_results).not.toContainEqual(
        expect.objectContaining({
          sourceFieldId: fieldId,
          reason: "raw_only_field",
        }),
      );
    }
  });

  it("blocks unknown required enums instead of inventing a default status", () => {
    const unknown = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        status: {
          id: "404",
          name: "Mystery",
          statusCategory: { key: "mystery" },
        },
      },
    });
    const plan = buildJiraIssueImportPlan(makeInput({ issue: unknown }));
    expect(plan.status).toBe("blocked");
    expect(plan.desired.issue).toBeNull();
    expect(plan.field_results).toContainEqual(
      expect.objectContaining({
        sourceFieldId: "status",
        classification: "blocked",
        reason: "status_unmapped",
      }),
    );
  });

  it("does not invent a close timestamp when Jira has no resolution date", () => {
    const closedWithoutTimestamp = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        status: {
          id: "3",
          name: "Done",
          statusCategory: { key: "done", name: "Done" },
        },
        resolution: { id: "1", name: "Done" },
        resolutiondate: null,
      },
    });
    const plan = buildJiraIssueImportPlan(
      makeInput({ issue: closedWithoutTimestamp }),
    );
    expect(plan.status).toBe("ready");
    expect(plan.desired.issue).toMatchObject({
      status: "closed",
      closed_reason: "completed",
      closed_at: null,
    });
  });

  it("suppresses fallback actor ids at the serialized plan boundary", () => {
    const plan = buildJiraIssueImportPlan(
      makeInput({
        accountMapping: {
          artifact: createJiraAccountMappingArtifact({
            jiraCloudId: "cloud-1",
          }),
        },
      }),
    );
    expect(plan.status).toBe("ready_with_warnings");
    expect(plan.desired.issue).toMatchObject({
      created_by: "migration-operator",
      assigned_to: null,
      reporter: null,
      requester: null,
    });
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        "actor_unmapped:creator",
        "actor_unmapped:assignee",
        "actor_unmapped:reporter",
        "actor_unmapped:requester",
      ]),
    );
    const serialized = JSON.stringify(plan);
    for (const forbidden of [
      "creator-private-id",
      "reporter-id",
      "assignee-id",
      "creator@example.test",
      "reporter@example.test",
      "assignee@example.test",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("blocks account artifacts from a different Jira cloud", () => {
    const plan = buildJiraIssueImportPlan(
      makeInput({
        accountMapping: {
          artifact: createJiraAccountMappingArtifact({
            jiraCloudId: "foreign-cloud",
            overrides: {
              "creator-private-id": { actor: "foreign-creator" },
              "reporter-id": { actor: "foreign-reporter" },
              "assignee-id": { actor: "foreign-assignee" },
            },
          }),
        },
      }),
    );
    expect(plan.status).toBe("blocked");
    expect(plan.desired.issue).toBeNull();
    expect(plan.warnings).toContain("account_mapping_cloud_mismatch");
    expect(plan.field_results).toContainEqual(
      expect.objectContaining({
        sourceFieldId: "account_mapping",
        classification: "blocked",
        reason: "account_mapping_cloud_mismatch",
      }),
    );
    expect(JSON.stringify(plan)).not.toContain("foreign-");
  });

  it("blocks a Rank plan for a different target Reef issue", () => {
    const plan = buildJiraIssueImportPlan(
      makeInput({
        rankPlan: buildJiraRankImportPlan([
          {
            reefId: "REEF-OTHER",
            jiraKey: "ALPHA-1",
            jiraRank: "0|i00010:",
          },
        ])[0],
      }),
    );
    expect(plan.status).toBe("blocked");
    expect(plan.desired.issue).toBeNull();
    expect(plan.warnings).toContain("rank_plan_issue_mismatch");
  });

  it("does not require a watcher-list archive for the standard watch summary", () => {
    const issueWithWatchSummary = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        watches: {
          self: "https://jira.example.test/rest/api/3/issue/ALPHA-1/watchers",
          watchCount: 2,
          isWatching: false,
        },
      },
    });
    const plan = buildJiraIssueImportPlan(
      makeInput({ issue: issueWithWatchSummary }),
    );
    expect(plan.status).toBe("ready");
    expect(plan.warnings).not.toContain(
      "raw_archive_reference_missing:watcher_list",
    );
    expect(JSON.stringify(plan)).not.toContain('"watches"');
  });

  it("blocks legacy sprint strings instead of silently dropping planning data", () => {
    const legacyCatalog = buildJiraFieldCatalog({
      retrievedAt: "2026-07-20T05:00:00.000Z",
      fields: [
        {
          id: "customfield_alpha_sprint",
          name: "Sprint",
          schema: {
            type: "array",
            items: "string",
            custom: "com.pyxis.greenhopper.jira:gh-sprint",
          },
        },
      ],
    });
    const legacyIssue = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        customfield_alpha_sprint: [
          "com.atlassian.greenhopper.service.sprint.Sprint@1[id=20,name=Sprint 1]",
        ],
      },
    });
    const plan = buildJiraIssueImportPlan(
      makeInput({ issue: legacyIssue, fieldCatalog: legacyCatalog }),
    );
    expect(plan.status).toBe("blocked");
    expect(plan.desired.issue).toBeNull();
    expect(plan.warnings).toContain("sprint_value_unsupported");
    expect(plan.field_results).toContainEqual(
      expect.objectContaining({
        sourceFieldId: "customfield_alpha_sprint",
        targetField: "sprint_id",
        classification: "blocked",
        reason: "sprint_value_unsupported",
        preservationLocation: "raw_preservation.archiveReferences",
      }),
    );
  });

  it("preserves all planning relations and requires an owner decision for multiple primaries", () => {
    const multiple = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        fixVersions: [
          { id: "10", name: "R1" },
          { id: "11", name: "R2" },
        ],
      },
    });
    const mapping = buildJiraPlanningTargetMappings([
      {
        sourceIdentity: jiraVersionSourceIdentity("cloud-1", "200", "10"),
        targetKind: "release",
        targetId: "release-1",
      },
      {
        sourceIdentity: jiraVersionSourceIdentity("cloud-1", "200", "11"),
        targetKind: "release",
        targetId: "release-2",
      },
    ]);
    const plan = buildJiraIssueImportPlan(
      makeInput({ issue: multiple, planningMappings: mapping }),
    );
    expect(plan.status).toBe("ready_with_warnings");
    expect(plan.desired.issue?.release_id).toBeNull();
    expect(
      plan.planning_associations.filter((item) => item.kind === "version"),
    ).toHaveLength(2);
    expect(
      plan.deferred.filter((item) => item.reason === "owner_decision_required"),
    ).toHaveLength(2);
  });

  it("defers missing planning bindings and unresolved/cross-project parents", () => {
    const crossProject = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        parent: { id: "777", key: "BETA-7" },
      },
    });
    const plan = buildJiraIssueImportPlan(
      makeInput({
        issue: crossProject,
        planningMappings: { releases: {}, sprints: {} },
        targetIdsByJiraKey: {},
      }),
    );
    expect(plan.desired.issue).toMatchObject({
      parent_id: null,
      release_id: null,
      sprint_id: null,
    });
    expect(plan.deferred).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "cross_project_reconcile",
          sourceKey: "BETA-7",
        }),
        expect.objectContaining({
          reason: "needs_release_mapping",
          sourceKey: versionKey,
        }),
        expect.objectContaining({
          reason: "needs_sprint_mapping",
          sourceKey: sprintKey,
        }),
      ]),
    );
  });

  it("blocks a subtask until its parent target is resolved", () => {
    const subtask = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        issuetype: {
          id: "100",
          name: "Task",
          subtask: true,
          hierarchyLevel: -1,
        },
        parent: { id: "777", key: "ALPHA-777" },
      },
    });
    const plan = buildJiraIssueImportPlan(
      makeInput({ issue: subtask, targetIdsByJiraKey: {} }),
    );
    expect(plan.status).toBe("blocked");
    expect(plan.desired.issue).toBeNull();
    expect(plan.warnings).toContain("subtask_parent_missing");
    expect(plan.deferred).toContainEqual(
      expect.objectContaining({
        kind: "parent",
        reason: "needs_parent_reconcile",
        sourceKey: "ALPHA-777",
      }),
    );
  });

  it("keeps Jira relations in a separate reconciliation report", () => {
    const related = JiraIssueSchema.parse({
      ...issueFixture,
      fields: {
        ...issueFixture.fields,
        issuelinks: [
          {
            id: "link-1",
            type: { id: "1", name: "Relates", outward: "relates to" },
            outwardIssue: { id: "2", key: "ALPHA-2" },
          },
          {
            id: "link-2",
            type: { id: "2", name: "Blocks", outward: "blocks" },
            outwardIssue: { id: "3", key: "BETA-3" },
          },
        ],
      },
    });
    const plan = buildJiraIssueImportPlan(
      makeInput({
        issue: related,
        targetIdsByJiraKey: { "ALPHA-2": "REEF-902" },
      }),
    );
    expect(plan.deferred).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "relation",
          reason: "needs_relation_reconcile",
          targetId: "REEF-902",
        }),
        expect.objectContaining({
          kind: "relation",
          reason: "cross_project_reconcile",
          targetId: null,
        }),
      ]),
    );
  });

  it("fails closed without required archive references and excludes raw/PII from serialization", () => {
    const blocked = buildJiraIssueImportPlan(
      makeInput({ rawArchiveReferences: {} }),
    );
    expect(blocked.status).toBe("blocked");
    expect(blocked.warnings).toEqual(
      expect.arrayContaining([
        "raw_archive_reference_missing:issue",
        "raw_archive_reference_missing:description_adf",
      ]),
    );

    const serialized = JSON.stringify(buildJiraIssueImportPlan(makeInput()));
    expect(serialized).not.toContain("creator@example.test");
    expect(serialized).not.toContain("reporter@example.test");
    expect(serialized).not.toContain("assignee@example.test");
    expect(serialized).not.toContain("creator-private-id");
    expect(serialized).not.toContain('"type":"doc"');
    expect(serialized).not.toContain('"watches"');
  });

  it("keeps Jira timestamps in provenance and omits validation timestamps from eventual writes", () => {
    const plan = buildJiraIssueImportPlan(makeInput());
    const desired = plan.desired.issue;
    expect(desired).not.toBeNull();
    if (!desired) throw new Error("expected a ready plan");
    expect(desired.created_at).toBe("2026-07-20T05:30:00.000Z");
    expect(desired.updated_at).toBe("2026-07-20T05:30:00.000Z");
    expect(desired.custom_fields).toMatchObject({
      jira: {
        timestamps: {
          created: "2024-01-01T01:00:00.000Z",
          updated: "2024-02-01T01:00:00.000Z",
        },
      },
    });
    const write = projectJiraIssueEventualWrite(desired);
    expect(write).not.toHaveProperty("created_at");
    expect(write).not.toHaveProperty("updated_at");
  });
});
