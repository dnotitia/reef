import { describe, expect, it } from "vitest";
import { DEFAULT_DEVELOPMENT_PROFILE_CATALOG } from "../schemas/ai";
import type { DevelopmentTargetItem } from "../schemas/ai/developmentTargets";
import type { Status } from "../schemas/issues";
import { resolveIssueRunRequestEligibility } from "./issueRunEligibility";

const eligibleTarget: DevelopmentTargetItem = {
  repo: { github_id: 123, owner: "dnotitia", name: "reef" },
  config: {
    github_id: 123,
    enabled: true,
    recipe_path: ".agents/recipes/reef.md",
    runner_profile: "default",
    permission_profile: ":workspace",
    branch_template: "feat/{issue_id}-{run_id}",
  },
  eligibility: { eligible: true, reason: null },
};

function resolve(
  overrides: Partial<
    Parameters<typeof resolveIssueRunRequestEligibility>[0]
  > = {},
) {
  return resolveIssueRunRequestEligibility({
    actor: "alice",
    role: "writer",
    issue: {
      assigned_to: null,
      archived_at: null,
      depends_on: [],
      issue_type: "story",
      status: "todo",
    },
    dependencyStatuses: new Map<string, Status>(),
    documentAvailable: true,
    targets: [eligibleTarget],
    catalog: DEFAULT_DEVELOPMENT_PROFILE_CATALOG,
    activeRun: null,
    ...overrides,
  });
}

describe("resolveIssueRunRequestEligibility", () => {
  it("returns one safe default target for an eligible writer request", () => {
    expect(resolve()).toEqual({
      eligible: true,
      reasons: [],
      target_options: [
        {
          github_id: 123,
          repo: "dnotitia/reef",
          recipe_path: ".agents/recipes/reef.md",
          branch_template: "feat/{issue_id}-{run_id}",
          runner_profile: { id: "default", label: "Default runner" },
          permission_profile: {
            id: ":workspace",
            label: "Workspace access",
          },
        },
      ],
      default_target_github_id: 123,
      active_run: null,
    });
  });

  it.each([
    ["reader", "not_authorized"],
    [null, "not_authorized"],
  ] as const)("rejects role %s", (role, reason) => {
    expect(resolve({ role }).reasons).toContain(reason);
  });

  it("enforces writer ownership while allowing admin override", () => {
    const issue = {
      assigned_to: "bob",
      archived_at: null,
      depends_on: [],
      issue_type: "task" as const,
      status: "todo" as const,
    };
    expect(resolve({ issue }).reasons).toContain("not_assignee");
    expect(resolve({ issue, role: "admin" }).eligible).toBe(true);
  });

  it("keeps authorization ahead of an active-run conflict", () => {
    const activeRun = {
      run_id: "run-active",
      status: "running" as const,
      phase: "implement" as const,
    };
    expect(resolve({ role: "reader", activeRun }).reasons[0]).toBe(
      "not_authorized",
    );
    expect(
      resolve({
        issue: {
          assigned_to: "bob",
          archived_at: null,
          depends_on: [],
          issue_type: "task",
          status: "todo",
        },
        activeRun,
      }).reasons[0],
    ).toBe("not_assignee");
  });

  it("keeps structural reasons in stable priority order", () => {
    const result = resolve({
      role: "reader",
      issue: {
        assigned_to: "bob",
        archived_at: "2026-07-01T00:00:00.000Z",
        depends_on: ["REEF-1", "REEF-missing"],
        issue_type: "epic",
        status: "in_progress",
      },
      documentAvailable: false,
      dependencyStatuses: new Map([["REEF-1", "todo"]]),
      targets: [],
      activeRun: {
        run_id: "run-active",
        status: "blocked",
        phase: "blocked",
      },
    });
    expect(result.reasons).toEqual([
      "not_authorized",
      "issue_archived",
      "issue_document_unavailable",
      "issue_type_not_runnable",
      "issue_status_not_todo",
      "unresolved_dependencies",
      "target_missing",
      "run_already_active",
    ]);
  });

  it("requires explicit selection when multiple targets are eligible", () => {
    const second = {
      ...eligibleTarget,
      repo: { github_id: 456, owner: "dnotitia", name: "akb" },
      config: {
        ...(eligibleTarget.config as NonNullable<typeof eligibleTarget.config>),
        github_id: 456,
      },
    };
    const result = resolve({ targets: [eligibleTarget, second] });
    expect(result.target_options).toHaveLength(2);
    expect(result.default_target_github_id).toBeNull();
  });

  it("does not accept or inspect issue body text", () => {
    expect(Object.keys(resolve)).not.toContain("content");
    expect(resolve().eligible).toBe(true);
  });
});
