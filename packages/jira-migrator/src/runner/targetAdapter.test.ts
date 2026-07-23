import type { AkbReadIssueResult, Release } from "@reef/core";
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
    const readIssue = vi.fn(
      async () =>
        ({
          issue: { id: "REEF-010", title: "Alpha issue" },
          content: "body",
          path: "issues/reef-010.md",
          commit_hash: "commit-1",
        }) as unknown as AkbReadIssueResult,
    );
    const writeIssue = vi.fn(async () => ({
      path: "issues/reef-010.md",
      commit_hash: "commit-1",
    }));
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
        createAdapter: () => ({ request: vi.fn() }),
        getCurrentActor: async () => ({ actor: "operator" }),
        listPlanningCatalog,
        createRelease,
        createSprint: vi.fn(),
        allocateNextIssueId: async () => "REEF-010",
        writeIssue,
        updateIssue: vi.fn(),
        readIssue,
      },
    );

    expect(await target.preflight()).toMatchObject({
      actor: "operator",
      vault: "reef-test",
    });
    expect(await target.reserveIssueIds(2)).toEqual(["REEF-010", "REEF-011"]);
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
    const applied = await target.applyIssue(issuePlan, "create");
    expect(writeIssue).toHaveBeenCalledTimes(1);
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
      },
    );
    await expect(
      target.applyIssue(
        { status: "blocked", desired: { issue: null, content: "" } } as never,
        "create",
      ),
    ).rejects.toThrow("jira_issue_plan_not_writable");
  });
});
