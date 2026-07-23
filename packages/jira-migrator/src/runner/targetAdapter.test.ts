import {
  type AkbReadIssueResult,
  type AkbUpdateIssueResult,
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
        },
      } as unknown as AkbReadIssueResult);
    const writeIssue = vi.fn(async () => ({
      path: "issues/reef-010.md",
      commit_hash: "commit-1",
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
                        issue_key: "LEGACY-1",
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
    });
    expect(
      await target.planIssueIds([
        {
          jira_cloud_id: "cloud-1",
          project_key: "ALPHA",
          issue_id: "10001",
          issue_key: "ALPHA-1",
        },
        {
          jira_cloud_id: "cloud-1",
          project_key: "BETA",
          issue_id: "20001",
          issue_key: "BETA-1",
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
    readIssue.mockResolvedValueOnce({
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
    await expect(
      target.applyIssue(updatedPlan, "update", targetAuthoredReadback),
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

  it("rejects a reused planning target that disappeared after preflight", async () => {
    const target = createAkbJiraMigrationTarget(
      {
        baseUrl: "https://akb.test",
        jwt: "jwt",
        vault: "reef-test",
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
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId: vi.fn(),
      },
    );

    await expect(
      target.applyPlanning({
        ...releaseAction,
        classification: "reuse",
        reason: "compatible_exact_name",
        targetId: "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toThrow("target_planning_readback_failed");
  });

  it("does not write blocked issue plans", async () => {
    const target = createAkbJiraMigrationTarget(
      { baseUrl: "https://akb.test", jwt: "jwt", vault: "reef-test" },
      {
        createAdapter: () => ({ request: vi.fn() }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(async () => null),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(),
        updateIssue: vi.fn(),
        readIssue: vi.fn(),
        claimIssueId: vi.fn(),
      },
    );
    await expect(
      target.applyIssue(
        { status: "blocked", desired: { issue: null, content: "" } } as never,
        "create",
      ),
    ).rejects.toThrow("jira_issue_plan_not_writable");
  });

  it("recovers an ambiguously acknowledged inverse relation write", async () => {
    const issues = new Map(
      ["REEF-001", "REEF-002"].map((id) => [
        id,
        {
          issue: {
            id,
            title: id,
            status: "todo",
            created_at: "2026-07-23T00:00:00.000Z",
            created_by: "operator",
            updated_at: "2026-07-23T00:00:00.000Z",
            updated_by: "operator",
            ...(id === "REEF-001" ? { blocks: ["REEF-002"] } : {}),
            ...(id === "REEF-002" ? { depends_on: ["REEF-001"] } : {}),
          },
          content: "",
          path: `issues/${id.toLowerCase()}.md`,
          commit_hash: `${id}-commit-0`,
        } as unknown as AkbReadIssueResult,
      ]),
    );
    let targetAttempts = 0;
    const updateIssue = vi.fn(async ({ id, partial }) => {
      const current = issues.get(id);
      if (!current) throw new NotFoundError({ resource: id });
      const next = {
        ...current,
        issue: { ...current.issue, ...partial },
        commit_hash: `${id}-commit-${updateIssue.mock.calls.length}`,
      } as AkbReadIssueResult;
      issues.set(id, next);
      if (id === "REEF-002" && targetAttempts++ === 0) {
        throw new Error("response_lost_after_commit");
      }
      return {
        commit_hash: next.commit_hash ?? "commit",
        issue: next.issue,
        content: next.content,
      };
    });
    const target = createAkbJiraMigrationTarget(
      { baseUrl: "https://akb.test", jwt: "jwt", vault: "reef-test" },
      {
        createAdapter: () => ({
          request: vi.fn(async (_path, init) => {
            const statement = (init?.body as { sql?: string } | undefined)?.sql;
            const idempotencyKey =
              statement &&
              /record->>'idempotencyKey' = '([^']+)'/u.exec(statement)?.[1];
            const field = statement?.includes("'external_refs'")
              ? "externalRefs"
              : "relations";
            const matchingIds = idempotencyKey
              ? [...issues.entries()].flatMap(([reefId, readback]) =>
                  sidecarForTest(readback.issue)[field].some(
                    (record) => record.idempotencyKey === idempotencyKey,
                  )
                    ? [reefId]
                    : [],
                )
              : [...issues.keys()];
            return {
              kind: "table_query",
              items: matchingIds.map((reef_id) => ({ reef_id })),
            };
          }),
        }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
        readPlanningCreateClaim: vi.fn(async () => null),
        allocateNextIssueId: vi.fn(),
        writeIssue: vi.fn(),
        updateIssue,
        readIssue: vi.fn(async ({ id }) => {
          const issue = issues.get(id);
          if (!issue) throw new NotFoundError({ resource: id });
          return structuredClone(issue);
        }),
        claimIssueId: vi.fn(),
      },
    );

    await expect(
      target.relatedTarget().putRelation({
        idempotencyKey: "relation:cloud-1:100",
        sourceReefId: "REEF-001",
        targetReefId: "REEF-002",
        relation: "blocks",
        inverseRelation: "depends_on",
        provenance: { jira_issue_link_id: "100" },
      }),
    ).resolves.toBeUndefined();

    expect(issues.get("REEF-001")?.issue.blocks).toEqual(["REEF-002"]);
    expect(issues.get("REEF-002")?.issue.depends_on).toEqual(["REEF-001"]);
    expect(
      (
        issues.get("REEF-001")?.issue.custom_fields as {
          jira_migration: { relations: Array<{ idempotencyKey: string }> };
        }
      ).jira_migration.relations,
    ).toContainEqual(
      expect.objectContaining({ idempotencyKey: "relation:cloud-1:100" }),
    );
    await expect(
      target.relatedTarget().hasRelation("relation:cloud-1:100"),
    ).resolves.toBe(true);

    const driftedTarget = issues.get("REEF-002");
    if (!driftedTarget) throw new Error("missing test target");
    issues.set("REEF-002", {
      ...driftedTarget,
      issue: { ...driftedTarget.issue, depends_on: [] },
    });
    await expect(
      target.relatedTarget().readRelation("relation:cloud-1:100"),
    ).resolves.toBeNull();
    await target.relatedTarget().putRelation({
      idempotencyKey: "relation:cloud-1:created",
      sourceReefId: "REEF-001",
      targetReefId: "REEF-002",
      relation: "related_to",
      inverseRelation: "related_to",
      provenance: { jira_issue_link_id: "created" },
    });
    await target.relatedTarget().putRelation({
      idempotencyKey: "relation:cloud-1:created",
      sourceReefId: "REEF-001",
      targetReefId: "REEF-002",
      relation: "depends_on",
      inverseRelation: "blocks",
      provenance: { jira_issue_link_id: "created" },
    });
    expect(issues.get("REEF-001")?.issue.related_to ?? []).toEqual([]);
    expect(issues.get("REEF-002")?.issue.related_to ?? []).toEqual([]);
    expect(issues.get("REEF-001")?.issue.depends_on).toEqual(["REEF-002"]);
    expect(issues.get("REEF-002")?.issue.blocks).toEqual(["REEF-001"]);
    await target.relatedTarget().putRelation({
      idempotencyKey: "relation:cloud-1:created-reverse",
      sourceReefId: "REEF-002",
      targetReefId: "REEF-001",
      relation: "blocks",
      inverseRelation: "depends_on",
      provenance: { jira_issue_link_id: "created-reverse" },
    });
    await target.relatedTarget().deleteRelation("relation:cloud-1:created");
    expect(issues.get("REEF-001")?.issue.depends_on).toEqual(["REEF-002"]);
    expect(issues.get("REEF-002")?.issue.blocks).toEqual(["REEF-001"]);
    await target
      .relatedTarget()
      .deleteRelation("relation:cloud-1:created-reverse");
    expect(issues.get("REEF-001")?.issue.depends_on ?? []).toEqual([]);
    expect(issues.get("REEF-002")?.issue.blocks ?? []).toEqual([]);
    await target.relatedTarget().putRelation({
      idempotencyKey: "relation:cloud-1:100",
      sourceReefId: "REEF-001",
      targetReefId: "REEF-002",
      relation: "blocks",
      inverseRelation: "depends_on",
      provenance: { jira_issue_link_id: "100" },
    });
    await target.relatedTarget().deleteRelation("relation:cloud-1:100");
    expect(issues.get("REEF-001")?.issue.blocks).toEqual(["REEF-002"]);
    expect(issues.get("REEF-002")?.issue.depends_on).toEqual(["REEF-001"]);
    await expect(
      target.relatedTarget().readRelation("relation:cloud-1:100"),
    ).resolves.toBeNull();

    const sourceWithSidecar = issues.get("REEF-001");
    if (!sourceWithSidecar) throw new Error("missing test source");
    const ref = { type: "jira" as const, url: "https://jira.test/browse/X-1" };
    const customFields = sourceWithSidecar.issue.custom_fields as {
      jira_migration: Record<string, unknown>;
    };
    issues.set("REEF-001", {
      ...sourceWithSidecar,
      issue: {
        ...sourceWithSidecar.issue,
        external_refs: [],
        custom_fields: {
          jira_migration: {
            ...customFields.jira_migration,
            external_refs: [
              {
                idempotencyKey: "external:cloud-1:1",
                reefId: "REEF-001",
                ref,
                provenance: {},
              },
            ],
          },
        },
      },
    });
    await expect(
      target.relatedTarget().hasExternalRef("external:cloud-1:1"),
    ).resolves.toBe(false);
    const sourceWithRef = issues.get("REEF-001");
    if (!sourceWithRef) throw new Error("missing test source");
    issues.set("REEF-001", {
      ...sourceWithRef,
      issue: { ...sourceWithRef.issue, external_refs: [ref] },
    });
    await expect(
      target.relatedTarget().readExternalRef("external:cloud-1:1"),
    ).resolves.toMatchObject({ reefId: "REEF-001", ref });

    const manualRef = {
      type: "jira" as const,
      url: "https://jira.test/browse/MANUAL-1",
    };
    const sourceBeforeManualRef = issues.get("REEF-001");
    if (!sourceBeforeManualRef) throw new Error("missing test source");
    issues.set("REEF-001", {
      ...sourceBeforeManualRef,
      issue: {
        ...sourceBeforeManualRef.issue,
        external_refs: [
          ...(sourceBeforeManualRef.issue.external_refs ?? []),
          manualRef,
        ],
      },
    });
    await target.relatedTarget().putExternalRef({
      idempotencyKey: "external:cloud-1:manual",
      reefId: "REEF-001",
      ref: manualRef,
      provenance: { source: "jira" },
    });
    await target.relatedTarget().deleteExternalRef("external:cloud-1:manual");
    expect(issues.get("REEF-001")?.issue.external_refs).toContainEqual(
      manualRef,
    );
    const createdRef = {
      type: "jira" as const,
      url: "https://jira.test/browse/CREATED-1",
    };
    await target.relatedTarget().putExternalRef({
      idempotencyKey: "external:cloud-1:created",
      reefId: "REEF-001",
      ref: createdRef,
      provenance: { source: "jira" },
    });
    await target.relatedTarget().deleteExternalRef("external:cloud-1:created");
    expect(issues.get("REEF-001")?.issue.external_refs).not.toContainEqual(
      createdRef,
    );
    const sidecarQueries = vi
      .mocked(target.adapter.request)
      .mock.calls.flatMap(([, init]) => {
        const statement = (init?.body as { sql?: unknown } | undefined)?.sql;
        return typeof statement === "string" ? [statement] : [];
      });
    expect(sidecarQueries).not.toContain(
      "SELECT reef_id, meta FROM reef_issues",
    );
    expect(
      sidecarQueries.some((statement) =>
        statement.includes("jsonb_array_elements"),
      ),
    ).toBe(true);
  });
});
