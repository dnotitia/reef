import {
  type AkbReadIssueResult,
  NotFoundError,
  type Release,
} from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import type { JiraIssueImportPlan } from "../issues/importPlan.js";
import type { JiraPlanningAction } from "../planning/entities.js";
import { createAkbJiraMigrationTarget } from "./targetAdapter.js";

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
    const readIssue = vi
      .fn()
      .mockRejectedValueOnce(new NotFoundError({ resource: "REEF-010" }))
      .mockResolvedValue({
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
      } as unknown as AkbReadIssueResult);
    const writeIssue = vi.fn(async () => ({
      path: "issues/reef-010.md",
      commit_hash: "commit-1",
    }));
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
        allocateNextIssueId: async () => "REEF-010",
        writeIssue,
        updateIssue: vi.fn(),
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
          request: vi.fn(async () => ({
            kind: "table_query",
            items: [...issues.keys()].map((reef_id) => ({ reef_id })),
          })),
        }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog: vi.fn(),
        createRelease: vi.fn(),
        createSprint: vi.fn(),
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
  });
});
