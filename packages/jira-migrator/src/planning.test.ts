import { describe, expect, it } from "vitest";
import type {
  NormalizedJiraSprint,
  NormalizedJiraVersion,
} from "./payloads.js";
import {
  buildJiraPlanningMigrationPlan,
  buildJiraPlanningTargetMappings,
  jiraSprintSourceIdentity,
  jiraVersionSourceIdentity,
  resolveJiraPlanningActionTarget,
} from "./planning.js";

const version = (
  overrides: Partial<NormalizedJiraVersion> = {},
): NormalizedJiraVersion => ({
  id: "70001",
  projectId: "200",
  name: "1.0",
  description: "First release",
  startDate: "2026-07-01",
  releaseDate: "2026-07-31",
  released: false,
  archived: false,
  ...overrides,
});

const sprint = (
  overrides: Partial<NormalizedJiraSprint> = {},
): NormalizedJiraSprint => ({
  id: "80001",
  state: "active",
  name: "Migration Sprint 1",
  startDate: "2026-07-01T00:00:00.000Z",
  endDate: "2026-07-14T00:00:00.000Z",
  completeDate: null,
  originBoardId: "90001",
  goal: "Prove migration",
  ...overrides,
});

const emptyInput = {
  jiraCloudId: "cloud-abc",
  projectKey: "ALPHA",
  versions: [],
  issueSprints: [],
  configuredBoards: [],
  existingReleases: [],
  existingSprints: [],
} as const;

describe("buildJiraPlanningMigrationPlan", () => {
  it("maps every configured-project Version with stable id identity and deterministic lifecycle", () => {
    const plan = buildJiraPlanningMigrationPlan({
      ...emptyInput,
      versions: [
        version(),
        version({
          id: "70002",
          projectId: "201",
          name: "Beta 2.0",
          released: true,
        }),
      ],
    });

    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0]).toMatchObject({
      classification: "create",
      selection: ["configured_project"],
      sourceIdentity: {
        kind: "version",
        key: "version:cloud-abc:200:70001",
      },
      target: {
        kind: "release",
        table: "reef_releases",
        item: {
          name: "1.0",
          status: "planned",
          target_date: "2026-07-31",
          released_at: null,
        },
      },
    });
    expect(plan.actions[1]?.target).toMatchObject({
      item: { name: "Beta 2.0", status: "released" },
    });
    expect(plan.actions[0]?.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "startDate",
          outcome: "preserved",
          preservedAt: "provenance.source.startDate",
        }),
      ]),
    );
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.actions)).toBe(true);
    expect(Object.isFrozen(plan.actions[0]?.target?.item)).toBe(true);
  });

  it("always selects issue Sprint references and only expands explicitly configured boards", () => {
    const issueReference = sprint({
      id: "81000",
      name: "Shared board sprint",
      startDate: null,
      endDate: null,
    });
    const plan = buildJiraPlanningMigrationPlan({
      ...emptyInput,
      projectKey: "BETA",
      issueSprints: [issueReference],
      configuredBoards: [
        {
          boardId: "90001",
          sprints: [
            sprint({
              id: "81000",
              name: "Shared board sprint",
              originBoardId: "90001",
            }),
            sprint({ id: "81001", name: "Board-only sprint" }),
          ],
        },
      ],
    });

    expect(plan.actions.map((action) => action.sourceIdentity.key)).toEqual([
      "sprint:cloud-abc:81000",
      "sprint:cloud-abc:81001",
    ]);
    expect(plan.actions[0]?.selection).toEqual([
      "issue_reference",
      "configured_board",
    ]);
    expect(plan.actions[0]?.target).toMatchObject({
      item: {
        start_date: "2026-07-01T00:00:00.000Z",
        end_date: "2026-07-14T00:00:00.000Z",
      },
    });
    expect(JSON.stringify(plan)).not.toContain("BETA");
  });

  it("prefers ledger bindings, reuses only a unique compatible name, and reports collisions", () => {
    const boundIdentity = jiraVersionSourceIdentity(
      "cloud-abc",
      "200",
      "70001",
    );
    const plan = buildJiraPlanningMigrationPlan({
      ...emptyInput,
      versions: [
        version(),
        version({ id: "70002", name: "Compatible" }),
        version({ id: "70003", name: "Duplicate" }),
        version({ id: "70004", name: "Incompatible" }),
      ],
      existingReleases: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          name: "Compatible",
          status: "planned",
          target_date: "2026-07-31",
          released_at: null,
          notes: "existing",
        },
        {
          id: "10000000-0000-4000-8000-000000000002",
          name: "Duplicate",
          status: "planned",
          target_date: "2026-07-31",
          released_at: null,
          notes: "first",
        },
        {
          id: "10000000-0000-4000-8000-000000000003",
          name: "duplicate",
          status: "planned",
          target_date: "2026-07-31",
          released_at: null,
          notes: "second",
        },
        {
          id: "10000000-0000-4000-8000-000000000004",
          name: "Incompatible",
          status: "released",
          target_date: "2026-07-31",
          released_at: "2026-07-31",
          notes: "different lifecycle",
        },
      ],
      ledgerBindings: [
        {
          sourceKey: boundIdentity.key,
          targetKind: "release",
          targetId: "10000000-0000-4000-8000-000000000099",
        },
      ],
    });

    expect(
      plan.actions.map(({ classification, reason }) => ({
        classification,
        reason,
      })),
    ).toEqual([
      { classification: "reuse", reason: "ledger_binding" },
      { classification: "reuse", reason: "compatible_exact_name" },
      { classification: "conflict", reason: "planning_conflict" },
      { classification: "conflict", reason: "planning_conflict" },
    ]);
    expect(plan.actions[2]?.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "name", outcome: "conflict" }),
      ]),
    );
    expect(plan.actions[3]?.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "status", outcome: "conflict" }),
      ]),
    );
  });

  it("reports duplicate target names across distinct source identities in the same plan", () => {
    const plan = buildJiraPlanningMigrationPlan({
      ...emptyInput,
      versions: [
        version({ id: "70001", projectId: "200", name: "Shared 1.0" }),
        version({ id: "70002", projectId: "201", name: "shared 1.0" }),
      ],
      issueSprints: [
        sprint({ id: "80001", name: "Shared Sprint" }),
        sprint({ id: "80002", name: "shared sprint" }),
      ],
    });

    expect(plan.summary).toEqual({
      create: 0,
      reuse: 0,
      conflict: 4,
      unsupported: 0,
    });
    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          classification: "conflict",
          reason: "planning_conflict",
          sourceIdentity: expect.objectContaining({ versionId: "70001" }),
        }),
        expect.objectContaining({
          classification: "conflict",
          reason: "planning_conflict",
          sourceIdentity: expect.objectContaining({ sprintId: "80002" }),
        }),
      ]),
    );
    expect(plan.actions[0]?.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "name",
          outcome: "conflict",
          reason: expect.stringContaining("multiple source identities"),
        }),
      ]),
    );
  });

  it("classifies unsupported lifecycle without leaking credentials or account fields", () => {
    const unsafeWireData = {
      ...sprint({ state: "paused" }),
      authorization: "Bearer jira-secret-token",
      watcher: { accountId: "private-account" },
    };
    const plan = buildJiraPlanningMigrationPlan({
      ...emptyInput,
      issueSprints: [unsafeWireData],
    });

    expect(plan.actions[0]).toMatchObject({
      classification: "unsupported",
      reason: "unsupported_lifecycle",
      target: null,
    });
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain("jira-secret-token");
    expect(serialized).not.toContain("private-account");
    expect(plan.actions[0]?.report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "state", outcome: "unsupported" }),
      ]),
    );
  });
});

describe("planning apply seam", () => {
  it("turns create/reuse results into ledger-ready and issue-consumable UUID mappings", () => {
    const plan = buildJiraPlanningMigrationPlan({
      ...emptyInput,
      versions: [version()],
      issueSprints: [sprint()],
    });
    const releaseResolution = resolveJiraPlanningActionTarget(
      plan.actions[0],
      "10000000-0000-4000-8000-000000000001",
    );
    const sprintResolution = resolveJiraPlanningActionTarget(
      plan.actions[1],
      "20000000-0000-4000-8000-000000000001",
    );
    const mappings = buildJiraPlanningTargetMappings([
      releaseResolution,
      sprintResolution,
    ]);

    expect(releaseResolution.sourceIdentity).toEqual(
      jiraVersionSourceIdentity("cloud-abc", "200", "70001"),
    );
    expect(sprintResolution.sourceIdentity).toEqual(
      jiraSprintSourceIdentity("cloud-abc", "80001"),
    );
    expect(mappings).toEqual({
      releases: {
        "version:cloud-abc:200:70001": "10000000-0000-4000-8000-000000000001",
      },
      sprints: {
        "sprint:cloud-abc:80001": "20000000-0000-4000-8000-000000000001",
      },
    });
    expect(Object.isFrozen(mappings.releases)).toBe(true);
  });
});
