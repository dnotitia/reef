import {
  AkbApiError,
  type AkbReadIssueResult,
  type AkbUpdateIssueResult,
  ConflictError,
  NotFoundError,
  type Release,
} from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import type { JiraPlanningAction } from "../planning/entities.js";
import { createAkbJiraMigrationTarget } from "./targetAdapter.js";

const sidecarForTest = (issue: AkbReadIssueResult["issue"]) => {
  const customFields =
    issue.custom_fields &&
    typeof issue.custom_fields === "object" &&
    !Array.isArray(issue.custom_fields)
      ? (issue.custom_fields as Record<string, unknown>)
      : {};
  const migration =
    customFields.jira_migration &&
    typeof customFields.jira_migration === "object" &&
    !Array.isArray(customFields.jira_migration)
      ? (customFields.jira_migration as Record<string, unknown>)
      : {};
  return {
    relations: Array.isArray(migration.relations)
      ? (migration.relations as Array<{ idempotencyKey: string }>)
      : [],
    externalRefs: Array.isArray(migration.external_refs)
      ? (migration.external_refs as Array<{ idempotencyKey: string }>)
      : [],
  };
};

const releaseAction: JiraPlanningAction = {
  classification: "create",
  reason: "no_exact_name_candidate",
  sourceIdentity: {
    kind: "version",
    jiraCloudId: "cloud-1",
    projectId: "100",
    versionId: "200",
    key: "version:cloud-1:100:200",
  },
  selection: ["configured_project"],
  target: {
    kind: "release",
    table: "reef_releases",
    item: {
      name: "Alpha 1.0",
      status: "planned",
      target_date: null,
      released_at: null,
      notes: "",
    },
  },
  targetId: null,
  provenance: {
    source: {
      kind: "version",
      jiraCloudId: "cloud-1",
      projectId: "100",
      projectKey: "ALPHA",
      versionId: "200",
      name: "Alpha 1.0",
      description: null,
      startDate: null,
      releaseDate: null,
      released: false,
      archived: false,
    },
    selection: ["configured_project"],
  },
  report: [],
};
describe("AKB Jira migration target", () => {
  it("normalizes Jira CRLF content before write and readback", async () => {
    const issue = {
      id: "REEF-011",
      title: "Line ending issue",
      status: "todo",
      created_at: "2026-07-23T00:00:00.000Z",
      created_by: "operator",
      updated_at: "2026-07-23T00:00:00.000Z",
      updated_by: "operator",
      custom_fields: {
        jira_migration: {
          owner: {
            jira_cloud_id: "cloud-1",
            project_key: "ALPHA",
            issue_id: "10002",
            issue_key: "ALPHA-2",
          },
        },
      },
    } as unknown as AkbReadIssueResult["issue"];
    const readIssue = vi
      .fn()
      .mockRejectedValueOnce(new NotFoundError({ resource: "REEF-011" }))
      .mockResolvedValue({
        issue,
        content: "first\nsecond",
        path: "issues/reef-011.md",
        commit_hash: "commit-1",
      } as unknown as AkbReadIssueResult);
    const writeIssue = vi.fn(async () => ({
      path: "issues/reef-011.md",
      commit_hash: "commit-1",
    }));
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
        issuePrefix: "REEF",
      },
      {
        createAdapter: () => ({ request: vi.fn() }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(async () => ({
          releases: [],
          sprints: [],
          milestones: [],
        })),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(),
        allocateNextIssueId: vi.fn(),
        writeIssue,
        updateIssue: vi.fn(),
        readIssue,
        claimIssueId: vi.fn(),
      },
    );
    const plan = {
      desired: { issue, content: "first\r\nsecond" },
      status: "ready",
    } as JiraIssueImportPlan;

    await expect(target.applyIssue(plan, "create")).resolves.toMatchObject({
      reefId: "REEF-011",
    });
    expect(writeIssue).toHaveBeenCalledWith(
      expect.objectContaining({ content: "first\nsecond" }),
    );
  });

  it("waits for a newly created planning item to become readable", async () => {
    const release = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Alpha 1.0",
      status: "planned" as const,
      notes: "",
    } as Release;
    const listPlanningCatalog = vi
      .fn()
      .mockResolvedValueOnce({
        releases: [],
        sprints: [],
        milestones: [],
      })
      .mockResolvedValue({
        releases: [release],
        sprints: [],
        milestones: [],
      });
    const waitForConsistency = vi.fn(async () => undefined);
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
        issuePrefix: "REEF",
      },
      {
        createAdapter: () => ({ request: vi.fn() }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog,
        createRelease: vi.fn(async () => release),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(async () => release),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId: vi.fn(),
        waitForConsistency,
      },
    );

    await expect(target.applyPlanning(releaseAction)).resolves.toMatchObject({
      targetId: release.id,
    });
    expect(listPlanningCatalog).toHaveBeenCalledTimes(2);
    expect(waitForConsistency).toHaveBeenCalledTimes(1);
    await expect(
      target.readPlanningClaim(releaseAction),
    ).resolves.toMatchObject({ targetId: release.id });
  });

  it("retries an ambiguous issue claim until its reservation is visible", async () => {
    const claimIssueId = vi
      .fn()
      .mockRejectedValueOnce(new ConflictError())
      .mockResolvedValue(undefined);
    const waitForConsistency = vi.fn(async () => undefined);
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
        issuePrefix: "REEF",
      },
      {
        createAdapter: () => ({ request: vi.fn() }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId,
        waitForConsistency,
      },
    );
    const issuePlan = {
      desired: {
        issue: {
          id: "REEF-010",
          title: "Alpha issue",
          status: "todo",
          created_at: "2026-07-23T00:00:00.000Z",
          created_by: "operator",
          updated_at: "2026-07-23T00:00:00.000Z",
          updated_by: "operator",
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
        },
        content: "body",
      },
      status: "ready",
    } as unknown as JiraIssueImportPlan;

    await expect(target.claimIssue(issuePlan)).resolves.toBeUndefined();
    expect(claimIssueId).toHaveBeenCalledTimes(2);
    expect(waitForConsistency).toHaveBeenCalledTimes(1);
  });

  it("retries an AKB network failure on a public issue read", async () => {
    const readback = {
      issue: {
        id: "REEF-010",
        title: "Alpha issue",
        status: "todo",
        created_at: "2026-07-23T00:00:00.000Z",
        created_by: "operator",
        updated_at: "2026-07-23T00:00:00.000Z",
        updated_by: "operator",
      },
      content: "body",
      path: "issues/reef-010.md",
      commit_hash: "commit-1",
    } as AkbReadIssueResult;
    const readIssue = vi
      .fn()
      .mockRejectedValueOnce(
        new AkbApiError({ status: 0, message: "connect timeout" }),
      )
      .mockResolvedValue(readback);
    const waitForConsistency = vi.fn(async () => undefined);
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
        issuePrefix: "REEF",
      },
      {
        createAdapter: () => ({ request: vi.fn() }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue,
        claimIssueId: vi.fn(),
        waitForConsistency,
      },
    );

    await expect(target.readIssue("REEF-010")).resolves.toBe(readback);
    expect(readIssue).toHaveBeenCalledTimes(2);
    expect(waitForConsistency).toHaveBeenCalledTimes(1);
  });

  it("accepts an independently verified existing Jira owner claim", async () => {
    const owner = {
      jira_cloud_id: "cloud-1",
      project_key: "ALPHA",
      issue_id: "10001",
      issue_key: "ALPHA-1",
    };
    const request = vi.fn(async () => ({
      kind: "table_query",
      items: [
        {
          reef_id: "REEF-010",
          document_uri: "akb://reef-test/coll/issues/doc/reef-010.md",
          archived_at: "2026-07-23T00:00:00.000Z",
          meta: {
            custom_fields: {
              jira_migration: {
                owner,
                reservation: true,
              },
            },
          },
        },
      ],
    }));
    const claimIssueId = vi.fn(async () => {
      throw new ConflictError();
    });
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
        issuePrefix: "REEF",
      },
      {
        createAdapter: () => ({ request }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId,
        waitForConsistency: vi.fn(),
      },
    );
    const issuePlan = {
      desired: {
        issue: {
          id: "REEF-010",
          title: "Alpha issue",
          status: "todo",
          created_at: "2026-07-23T00:00:00.000Z",
          created_by: "operator",
          updated_at: "2026-07-23T00:00:00.000Z",
          updated_by: "operator",
          custom_fields: {
            jira_migration: { owner },
          },
        },
        content: "body",
      },
      status: "ready",
    } as unknown as JiraIssueImportPlan;

    await expect(target.claimIssue(issuePlan)).resolves.toBeUndefined();
    expect(claimIssueId).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("confirms an issue write that committed before a stale readback conflict", async () => {
    const issue = {
      id: "REEF-010",
      title: "Alpha issue",
      status: "todo",
      created_at: "2026-07-23T00:00:00.000Z",
      created_by: "operator",
      updated_at: "2026-07-23T00:00:00.000Z",
      updated_by: "operator",
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
    const exactReadback = {
      issue,
      content: "body",
      path: "issues/reef-010.md",
      commit_hash: "commit-1",
    } as AkbReadIssueResult;
    const staleReadback = {
      ...exactReadback,
      issue: {
        ...issue,
        archived_at: issue.updated_at,
        custom_fields: {
          jira_migration: {
            ...issue.custom_fields.jira_migration,
            reservation: true,
          },
        },
      },
    } as AkbReadIssueResult;
    const readIssue = vi
      .fn()
      .mockRejectedValueOnce(new NotFoundError({ resource: issue.id }))
      .mockResolvedValueOnce(staleReadback)
      .mockResolvedValueOnce(exactReadback);
    const waitForConsistency = vi.fn(async () => undefined);
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
        issuePrefix: "REEF",
      },
      {
        createAdapter: () => ({ request: vi.fn() }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(async () => {
          throw new ConflictError();
        }),
        updateIssue: vi.fn(),
        readIssue,
        claimIssueId: vi.fn(),
        waitForConsistency,
      },
    );

    await expect(
      target.applyIssue(
        {
          desired: { issue, content: "body" },
          status: "ready",
        } as unknown as JiraIssueImportPlan,
        "create",
      ),
    ).resolves.toMatchObject({ commitHash: "commit-1" });
    expect(readIssue).toHaveBeenCalledTimes(3);
    expect(waitForConsistency).toHaveBeenCalledTimes(1);
  });
});
