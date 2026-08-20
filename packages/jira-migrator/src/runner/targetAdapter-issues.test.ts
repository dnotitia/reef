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
  it("allocates issue ids from the initialized target workspace prefix", async () => {
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "saasv31-smoke",
      },
      {
        createAdapter: () => ({
          request: vi.fn(async () => ({ kind: "table_query", items: [] })),
        }),
        getCurrentActor: async () => ({ actor: "operator" }),
        readConfig: vi.fn(async () => ({
          exists: true,
          config: {
            project_prefix: "SAASV31",
            monitored_repos: [],
            authoring_language: "ko" as const,
            stale_hide_completed_days: 28,
            stale_hide_canceled_days: 7,
          },
        })),
        listPlanningCatalog: vi.fn(async () => ({
          releases: [],
          sprints: [],
          milestones: [],
        })),
        listVaultMembers: vi.fn(async () => ({
          members: [
            {
              username: "operator",
              display_name: "Operator",
              email: "operator@example.com",
              role: "owner",
            },
          ],
        })),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId: vi.fn(),
      },
    );

    await expect(target.preflight()).resolves.toMatchObject({
      projectPrefix: "SAASV31",
      actorDirectory: [
        {
          actor: "operator",
          displayName: "Operator",
          emailAddress: "operator@example.com",
        },
      ],
      memberActors: ["operator"],
    });
    await expect(
      target.planIssueIds([
        {
          jira_cloud_id: "cloud-1",
          project_key: "SAASV31",
          issue_id: "29449",
          issue_key: "SAASV31-1",
        },
      ]),
    ).resolves.toEqual(["SAASV31-1"]);
  });

  it("preserves Jira issue numbers and rejects target aliases or collisions", async () => {
    const request = vi.fn(async () => ({
      kind: "table_query" as const,
      items: [
        {
          reef_id: "SHDEV-001",
          meta: {
            custom_fields: {
              jira_migration: {
                owner: {
                  jira_cloud_id: "cloud-1",
                  project_key: "SHDEV",
                  issue_id: "10001",
                  issue_key: "SHDEV-1",
                },
              },
            },
          },
        },
      ],
    }));
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-shdev",
        issuePrefix: "SHDEV",
      },
      {
        createAdapter: () => ({ request }),
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
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId: vi.fn(),
      },
    );

    await target.preflight();
    await expect(
      target.planIssueIds([
        {
          jira_cloud_id: "cloud-1",
          project_key: "SHDEV",
          issue_id: "10001",
          issue_key: "SHDEV-1",
        },
      ]),
    ).rejects.toThrow("target_issue_id_mismatch");
    await expect(
      target.planIssueIds([
        {
          jira_cloud_id: "cloud-1",
          project_key: "SHDEV",
          issue_id: "10002",
          issue_key: "SHDEV-1",
        },
      ]),
    ).rejects.toThrow("target_issue_id_conflict");
  });

  it("keeps a stable binding after a Jira key rename", async () => {
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-shdev",
        issuePrefix: "SHDEV",
      },
      {
        createAdapter: () => ({
          request: vi.fn(async () => ({
            kind: "table_query",
            items: [
              {
                reef_id: "SHDEV-7",
                meta: {
                  custom_fields: {
                    jira_migration: {
                      owner: {
                        jira_cloud_id: "cloud-1",
                        project_key: "OLD",
                        issue_id: "10001",
                        issue_key: "OLD-7",
                      },
                    },
                  },
                },
              },
            ],
          })),
        }),
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
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId: vi.fn(),
      },
    );

    await target.preflight();
    await expect(
      target.planIssueIds([
        {
          jira_cloud_id: "cloud-1",
          project_key: "SHDEV",
          issue_id: "10001",
          issue_key: "SHDEV-91",
        },
      ]),
    ).resolves.toEqual(["SHDEV-7"]);
  });

  it("uses core public planning and paired issue writes with readback", async () => {
    const createRelease = vi.fn(
      async () =>
        ({
          id: "11111111-1111-4111-8111-111111111111",
          ...(releaseAction.target?.kind === "release"
            ? releaseAction.target.item
            : {}),
        }) as Release,
    );
    const readPlanningCreateClaim = vi.fn(
      async () =>
        ({
          id: "11111111-1111-4111-8111-111111111111",
          ...(releaseAction.target?.kind === "release"
            ? releaseAction.target.item
            : {}),
        }) as Release,
    );
    const baseIssueReadback = {
      issue: {
        id: "REEF-010",
        title: "Alpha issue",
        status: "todo",
        created_at: "2026-07-23T00:00:01.000Z",
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
      path: "issues/reef-010.md",
      commit_hash: "commit-1",
    } as unknown as AkbReadIssueResult;
    const targetAuthoredReadback = {
      ...baseIssueReadback,
      issue: {
        ...baseIssueReadback.issue,
        custom_fields: {
          target_authored: { keep: true },
          jira_migration: {
            owner: {
              jira_cloud_id: "cloud-1",
              project_key: "ALPHA",
              issue_id: "10001",
              issue_key: "ALPHA-1",
            },
            relations: [],
            external_refs: [],
          },
        },
      },
    } as unknown as AkbReadIssueResult;
    const readIssue = vi
      .fn()
      .mockRejectedValueOnce(new NotFoundError({ resource: "REEF-010" }))
      .mockResolvedValueOnce(baseIssueReadback)
      .mockResolvedValueOnce(targetAuthoredReadback)
      .mockResolvedValueOnce({
        ...targetAuthoredReadback,
        issue: {
          ...targetAuthoredReadback.issue,
          title: "Updated Alpha issue",
          custom_fields: {
            ...targetAuthoredReadback.issue.custom_fields,
            jira_migration: {
              ...(targetAuthoredReadback.issue.custom_fields
                ?.jira_migration as Record<string, unknown>),
              managed_custom_field_keys: [],
            },
          },
        },
      } as unknown as AkbReadIssueResult);
    const writeIssue = vi.fn(async () => ({
      path: "issues/reef-010.md",
      commit_hash: "commit-1",
      issue: baseIssueReadback.issue,
    }));
    const updateIssue = vi.fn(
      async (): Promise<AkbUpdateIssueResult> => ({
        ...targetAuthoredReadback,
        commit_hash: "commit-1",
        issue: {
          ...targetAuthoredReadback.issue,
          title: "Updated Alpha issue",
        },
      }),
    );
    const claimIssueId = vi.fn();
    const listPlanningCatalog = vi
      .fn()
      .mockResolvedValueOnce({
        releases: [],
        sprints: [],
        milestones: [],
      })
      .mockResolvedValueOnce({
        releases: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            ...(releaseAction.target?.kind === "release"
              ? releaseAction.target.item
              : {}),
          },
        ],
        sprints: [],
        milestones: [],
      })
      .mockResolvedValue({
        releases: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            ...(releaseAction.target?.kind === "release"
              ? releaseAction.target.item
              : {}),
          },
        ],
        sprints: [],
        milestones: [],
      });
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
        issuePrefix: "REEF",
      },
      {
        createAdapter: () => ({
          request: vi.fn(async () => ({
            kind: "table_query",
            items: [
              {
                reef_id: "REEF-009",
                meta: {
                  custom_fields: {
                    jira_migration: {
                      owner: {
                        jira_cloud_id: "cloud-1",
                        project_key: "LEGACY",
                        issue_id: "10001",
                        issue_key: "LEGACY-009",
                      },
                    },
                  },
                },
              },
            ],
          })),
        }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog,
        createRelease,
        createSprint: vi.fn(),
        readPlanningCreateClaim,
        allocateNextIssueId: async () => "REEF-010",
        writeIssue,
        updateIssue,
        readIssue,
        claimIssueId,
      },
    );

    expect(await target.preflight()).toMatchObject({
      actor: "operator",
      vault: "reef-test",
      projectPrefix: "REEF",
    });
    expect(
      await target.planIssueIds([
        {
          jira_cloud_id: "cloud-1",
          project_key: "ALPHA",
          issue_id: "10001",
          issue_key: "ALPHA-009",
        },
        {
          jira_cloud_id: "cloud-1",
          project_key: "BETA",
          issue_id: "20001",
          issue_key: "BETA-010",
        },
      ]),
    ).toEqual(["REEF-009", "REEF-010"]);
    expect(await target.applyPlanning(releaseAction)).toMatchObject({
      targetKind: "release",
      targetId: "11111111-1111-4111-8111-111111111111",
    });
    expect(createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: releaseAction.sourceIdentity.key,
      }),
    );
    await expect(
      target.applyPlanning({
        ...releaseAction,
        classification: "reuse",
        reason: "compatible_exact_name",
        targetId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      targetKind: "release",
      targetId: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      target.readPlanningClaim({
        ...releaseAction,
        classification: "reuse",
        reason: "compatible_exact_name",
        targetId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toMatchObject({
      targetKind: "release",
      targetId: "11111111-1111-4111-8111-111111111111",
    });

    const issuePlan = {
      desired: {
        issue: {
          id: "REEF-010",
          title: "Alpha issue",
          status: "todo",
          priority: null,
          created_at: "2026-07-23T00:00:00.000Z",
          created_by: "operator",
          updated_at: "2026-07-23T00:00:00.000Z",
          updated_by: "operator",
          custom_fields: baseIssueReadback.issue.custom_fields,
        },
        content: "body",
      },
      status: "ready",
    } as JiraIssueImportPlan;
    await target.claimIssue(issuePlan);
    expect(claimIssueId).toHaveBeenCalledWith(
      expect.objectContaining({
        issue: expect.objectContaining({ id: "REEF-010" }),
      }),
    );
    const applied = await target.applyIssue(issuePlan, "create");
    expect(writeIssue).toHaveBeenCalledTimes(1);
    expect(writeIssue).toHaveBeenCalledWith(
      expect.objectContaining({ claimFirst: true }),
    );
    expect(readIssue).toHaveBeenCalledWith(
      expect.objectContaining({ id: "REEF-010" }),
    );
    expect(applied.documentUri).toBe(
      "akb://reef-test/coll/issues/doc/reef-010.md",
    );
    readIssue.mockReset();
    readIssue
      .mockResolvedValueOnce({
        ...baseIssueReadback,
        issue: {
          ...baseIssueReadback.issue,
          archived_at: "2026-07-23T00:00:00.000Z",
          custom_fields: {
            jira_migration: {
              owner: {
                jira_cloud_id: "cloud-1",
                project_key: "LEGACY",
                issue_id: "10001",
                issue_key: "LEGACY-1",
              },
              reservation: true,
            },
          },
        },
      } as unknown as AkbReadIssueResult)
      .mockResolvedValueOnce(baseIssueReadback);
    await expect(target.applyIssue(issuePlan, "create")).resolves.toMatchObject(
      {
        reefId: "REEF-010",
        commitHash: "commit-1",
      },
    );
    expect(writeIssue).toHaveBeenCalledTimes(2);
    const updatedPlan = {
      ...issuePlan,
      desired: {
        ...issuePlan.desired,
        issue: {
          ...issuePlan.desired.issue,
          title: "Updated Alpha issue",
        },
      },
    } as JiraIssueImportPlan;
    readIssue.mockReset();
    readIssue.mockResolvedValueOnce({
      ...targetAuthoredReadback,
      issue: {
        ...targetAuthoredReadback.issue,
        title: "Drifted Alpha issue",
      },
    } as unknown as AkbReadIssueResult);
    await expect(
      target.applyIssue(updatedPlan, "update", targetAuthoredReadback),
    ).rejects.toThrow("target_issue_id_conflict");
    expect(updateIssue).not.toHaveBeenCalled();

    readIssue
      .mockResolvedValueOnce(targetAuthoredReadback)
      .mockResolvedValueOnce({
        ...targetAuthoredReadback,
        issue: {
          ...targetAuthoredReadback.issue,
          title: "Updated Alpha issue",
          custom_fields: {
            ...targetAuthoredReadback.issue.custom_fields,
            jira_migration: {
              ...(targetAuthoredReadback.issue.custom_fields
                ?.jira_migration as Record<string, unknown>),
              managed_custom_field_keys: [],
            },
          },
        },
      } as unknown as AkbReadIssueResult);
    await expect(
      target.applyIssue(updatedPlan, "update", {
        ...targetAuthoredReadback,
        issue: {
          ...targetAuthoredReadback.issue,
          assigned_to: undefined,
        },
      } as unknown as AkbReadIssueResult),
    ).resolves.toMatchObject({
      reefId: "REEF-010",
      commitHash: "commit-1",
    });
    expect(updateIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        partial: expect.objectContaining({
          custom_fields: expect.objectContaining({
            target_authored: { keep: true },
          }),
        }),
      }),
    );
    const updateCalls = updateIssue.mock.calls.length;
    readIssue.mockResolvedValueOnce({
      ...targetAuthoredReadback,
      issue: {
        ...targetAuthoredReadback.issue,
        custom_fields: {
          jira_migration: {
            owner: {
              jira_cloud_id: "other-cloud",
              issue_id: "99999",
            },
          },
        },
      },
    } as unknown as AkbReadIssueResult);
    await expect(target.applyIssue(updatedPlan, "update")).rejects.toThrow(
      "target_issue_id_conflict",
    );
    expect(updateIssue).toHaveBeenCalledTimes(updateCalls);
  });
});
