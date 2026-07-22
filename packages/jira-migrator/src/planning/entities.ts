import type { Release, Sprint } from "@reef/core";
import type {
  NormalizedJiraSprint,
  NormalizedJiraVersion,
} from "../payloads.js";

export type JiraPlanningEntityKind = "version" | "sprint";
export type JiraPlanningTargetKind = "release" | "sprint";
export type JiraPlanningActionClassification =
  | "create"
  | "reuse"
  | "conflict"
  | "unsupported";
export type JiraPlanningSelectionReason =
  | "configured_project"
  | "issue_reference"
  | "configured_board";

interface JiraPlanningSourceIdentityBase {
  kind: JiraPlanningEntityKind;
  jiraCloudId: string;
  key: string;
}

export interface JiraVersionSourceIdentity
  extends JiraPlanningSourceIdentityBase {
  kind: "version";
  projectId: string;
  versionId: string;
}

export interface JiraSprintSourceIdentity
  extends JiraPlanningSourceIdentityBase {
  kind: "sprint";
  sprintId: string;
}

export type JiraPlanningSourceIdentity =
  | JiraVersionSourceIdentity
  | JiraSprintSourceIdentity;

export interface JiraPlanningFieldReport {
  field: string;
  outcome: "mapped" | "preserved" | "conflict" | "unsupported";
  reason: string;
  preservedAt?: string;
}

export type JiraPlanningTargetCandidate =
  | {
      kind: "release";
      table: "reef_releases";
      item: Omit<Release, "id">;
    }
  | {
      kind: "sprint";
      table: "reef_sprints";
      item: Omit<Sprint, "id">;
    };

export type JiraPlanningSourceProvenance =
  | {
      kind: "version";
      jiraCloudId: string;
      projectId: string;
      projectKey: string;
      versionId: string;
      name: string;
      description: string | null;
      startDate: string | null;
      releaseDate: string | null;
      released: boolean;
      archived: boolean;
    }
  | {
      kind: "sprint";
      jiraCloudId: string;
      sprintId: string;
      name: string;
      state: string;
      startDate: string | null;
      endDate: string | null;
      completeDate: string | null;
      goal: string | null;
      originBoardId: string | null;
    };

export interface JiraPlanningAction {
  classification: JiraPlanningActionClassification;
  reason:
    | "ledger_binding"
    | "compatible_exact_name"
    | "no_exact_name_candidate"
    | "planning_conflict"
    | "unsupported_lifecycle";
  sourceIdentity: JiraPlanningSourceIdentity;
  selection: readonly JiraPlanningSelectionReason[];
  target: JiraPlanningTargetCandidate | null;
  targetId: string | null;
  provenance: {
    source: JiraPlanningSourceProvenance;
    selection: readonly JiraPlanningSelectionReason[];
  };
  report: readonly JiraPlanningFieldReport[];
}

export interface JiraPlanningLedgerBinding {
  sourceKey: string;
  targetKind: JiraPlanningTargetKind;
  targetId: string;
}

export interface JiraConfiguredBoardSprintCatalog {
  boardId: string;
  sprints: readonly NormalizedJiraSprint[];
}

export interface BuildJiraPlanningMigrationPlanInput {
  jiraCloudId: string;
  projectKey: string;
  versions: readonly NormalizedJiraVersion[];
  issueSprints: readonly NormalizedJiraSprint[];
  configuredBoards: readonly JiraConfiguredBoardSprintCatalog[];
  existingReleases: readonly Release[];
  existingSprints: readonly Sprint[];
  ledgerBindings?: readonly JiraPlanningLedgerBinding[];
}

export interface JiraPlanningMigrationPlan {
  actions: readonly JiraPlanningAction[];
  summary: Readonly<Record<JiraPlanningActionClassification, number>>;
}

export interface JiraPlanningTargetResolution {
  sourceIdentity: JiraPlanningSourceIdentity;
  targetKind: JiraPlanningTargetKind;
  targetId: string;
}

export interface JiraPlanningTargetMappings {
  releases: Readonly<Record<string, string>>;
  sprints: Readonly<Record<string, string>>;
}

const encodeKeyPart = (value: string): string => encodeURIComponent(value);

export const jiraVersionSourceIdentity = (
  jiraCloudId: string,
  projectId: string,
  versionId: string,
): JiraVersionSourceIdentity => ({
  kind: "version",
  jiraCloudId,
  projectId,
  versionId,
  key: `version:${encodeKeyPart(jiraCloudId)}:${encodeKeyPart(projectId)}:${encodeKeyPart(versionId)}`,
});

export const jiraSprintSourceIdentity = (
  jiraCloudId: string,
  sprintId: string,
): JiraSprintSourceIdentity => ({
  kind: "sprint",
  jiraCloudId,
  sprintId,
  key: `sprint:${encodeKeyPart(jiraCloudId)}:${encodeKeyPart(sprintId)}`,
});

const normalizeName = (name: string): string => name.trim().toLowerCase();

const sameOptionalValue = (
  source: string | null | undefined,
  target: string | null | undefined,
): boolean => source == null || source === target;

const versionTarget = (
  version: NormalizedJiraVersion,
): JiraPlanningTargetCandidate => ({
  kind: "release",
  table: "reef_releases",
  item: {
    name: version.name,
    status: version.released ? "released" : "planned",
    target_date: version.releaseDate,
    released_at: version.released ? version.releaseDate : null,
    notes: version.description ?? "",
  },
});

const sprintTarget = (
  sprint: NormalizedJiraSprint,
): JiraPlanningTargetCandidate | null => {
  const status =
    sprint.state === "future"
      ? "planned"
      : sprint.state === "active" || sprint.state === "closed"
        ? sprint.state
        : null;
  if (!status) return null;
  return {
    kind: "sprint",
    table: "reef_sprints",
    item: {
      name: sprint.name,
      status,
      start_date: sprint.startDate,
      end_date: sprint.endDate,
      goal: sprint.goal ?? "",
      capacity_points: null,
    },
  };
};

const versionReport = (
  version: NormalizedJiraVersion,
): JiraPlanningFieldReport[] => [
  { field: "name", outcome: "mapped", reason: "release.name" },
  { field: "released", outcome: "mapped", reason: "release.status" },
  {
    field: "releaseDate",
    outcome: "mapped",
    reason: "release.target_date and release.released_at",
  },
  { field: "description", outcome: "mapped", reason: "release.notes" },
  {
    field: "startDate",
    outcome: "preserved",
    reason: "reef release has no start-date field",
    preservedAt: "provenance.source.startDate",
  },
  {
    field: "archived",
    outcome: "preserved",
    reason: "reef release has no archived lifecycle",
    preservedAt: "provenance.source.archived",
  },
  {
    field: "projectId",
    outcome: "preserved",
    reason: "source identity and project provenance",
    preservedAt: "provenance.source.projectId",
  },
];

const sprintReport = (
  sprint: NormalizedJiraSprint,
  target: JiraPlanningTargetCandidate | null,
): JiraPlanningFieldReport[] => [
  { field: "name", outcome: "mapped", reason: "sprint.name" },
  {
    field: "state",
    outcome: target ? "mapped" : "unsupported",
    reason: target
      ? "sprint.status"
      : `unsupported Jira state: ${sprint.state}`,
  },
  { field: "startDate", outcome: "mapped", reason: "sprint.start_date" },
  { field: "endDate", outcome: "mapped", reason: "sprint.end_date" },
  { field: "goal", outcome: "mapped", reason: "sprint.goal" },
  {
    field: "completeDate",
    outcome: "preserved",
    reason: "reef sprint has no completion-date field",
    preservedAt: "provenance.source.completeDate",
  },
  {
    field: "originBoardId",
    outcome: "preserved",
    reason: "board provenance is not a reef sprint field",
    preservedAt: "provenance.source.originBoardId",
  },
];

const versionCompatible = (
  candidate: Extract<JiraPlanningTargetCandidate, { kind: "release" }>,
  existing: Release,
): string[] => {
  const conflicts: string[] = [];
  if (candidate.item.status !== existing.status) conflicts.push("status");
  if (!sameOptionalValue(candidate.item.target_date, existing.target_date)) {
    conflicts.push("target_date");
  }
  if (!sameOptionalValue(candidate.item.released_at, existing.released_at)) {
    conflicts.push("released_at");
  }
  return conflicts;
};

const sprintCompatible = (
  candidate: Extract<JiraPlanningTargetCandidate, { kind: "sprint" }>,
  existing: Sprint,
): string[] => {
  const conflicts: string[] = [];
  if (candidate.item.status !== existing.status) conflicts.push("status");
  if (!sameOptionalValue(candidate.item.start_date, existing.start_date)) {
    conflicts.push("start_date");
  }
  if (!sameOptionalValue(candidate.item.end_date, existing.end_date)) {
    conflicts.push("end_date");
  }
  return conflicts;
};

const classifyAction = (
  sourceIdentity: JiraPlanningSourceIdentity,
  selection: JiraPlanningSelectionReason[],
  target: JiraPlanningTargetCandidate | null,
  provenance: JiraPlanningSourceProvenance,
  baseReport: JiraPlanningFieldReport[],
  existingReleases: readonly Release[],
  existingSprints: readonly Sprint[],
  ledgerBindings: ReadonlyMap<string, JiraPlanningLedgerBinding>,
): JiraPlanningAction => {
  const ledger = ledgerBindings.get(sourceIdentity.key);
  const expectedTargetKind =
    sourceIdentity.kind === "version" ? "release" : "sprint";
  if (ledger && ledger.targetKind === expectedTargetKind) {
    return {
      classification: "reuse",
      reason: "ledger_binding",
      sourceIdentity,
      selection,
      target,
      targetId: ledger.targetId,
      provenance: { source: provenance, selection },
      report: baseReport,
    };
  }

  if (!target) {
    return {
      classification: "unsupported",
      reason: "unsupported_lifecycle",
      sourceIdentity,
      selection,
      target: null,
      targetId: null,
      provenance: { source: provenance, selection },
      report: baseReport,
    };
  }

  const candidates =
    target.kind === "release"
      ? existingReleases.filter(
          (item) =>
            normalizeName(item.name) === normalizeName(target.item.name),
        )
      : existingSprints.filter(
          (item) =>
            normalizeName(item.name) === normalizeName(target.item.name),
        );
  if (candidates.length === 0) {
    return {
      classification: "create",
      reason: "no_exact_name_candidate",
      sourceIdentity,
      selection,
      target,
      targetId: null,
      provenance: { source: provenance, selection },
      report: baseReport,
    };
  }

  const conflictFields =
    candidates.length > 1
      ? ["name"]
      : target.kind === "release"
        ? versionCompatible(target, candidates[0] as Release)
        : sprintCompatible(target, candidates[0] as Sprint);
  if (conflictFields.length > 0) {
    return {
      classification: "conflict",
      reason: "planning_conflict",
      sourceIdentity,
      selection,
      target,
      targetId: null,
      provenance: { source: provenance, selection },
      report: [
        ...baseReport,
        ...conflictFields.map((field) => ({
          field,
          outcome: "conflict" as const,
          reason:
            candidates.length > 1
              ? "multiple case-insensitive exact-name candidates"
              : "exact-name candidate has incompatible planning metadata",
        })),
      ],
    };
  }

  return {
    classification: "reuse",
    reason: "compatible_exact_name",
    sourceIdentity,
    selection,
    target,
    targetId: candidates[0]?.id ?? null,
    provenance: { source: provenance, selection },
    report: baseReport,
  };
};

const mergeSprint = (
  current: NormalizedJiraSprint,
  incoming: NormalizedJiraSprint,
): NormalizedJiraSprint => ({
  id: current.id,
  state: incoming.state || current.state,
  name: incoming.name || current.name,
  startDate: incoming.startDate ?? current.startDate,
  endDate: incoming.endDate ?? current.endDate,
  completeDate: incoming.completeDate ?? current.completeDate,
  originBoardId: incoming.originBoardId ?? current.originBoardId,
  goal: incoming.goal ?? current.goal,
});

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const markInPlanNameConflicts = (
  actions: JiraPlanningAction[],
): JiraPlanningAction[] => {
  const groups = new Map<string, number[]>();
  for (const [index, action] of actions.entries()) {
    if (!action.target) continue;
    const key = `${action.target.kind}:${normalizeName(action.target.item.name)}`;
    const group = groups.get(key);
    if (group) group.push(index);
    else groups.set(key, [index]);
  }

  const result = [...actions];
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      const action = result[index];
      if (!action || action.reason === "ledger_binding") continue;
      result[index] = {
        ...action,
        classification: "conflict",
        reason: "planning_conflict",
        targetId: null,
        report: [
          ...action.report,
          {
            field: "name",
            outcome: "conflict",
            reason:
              "multiple source identities resolve to the same case-insensitive target name",
          },
        ],
      };
    }
  }
  return result;
};

export const buildJiraPlanningMigrationPlan = (
  input: BuildJiraPlanningMigrationPlanInput,
): JiraPlanningMigrationPlan => {
  const ledgerBindings = new Map(
    (input.ledgerBindings ?? []).map((binding) => [binding.sourceKey, binding]),
  );
  const actions: JiraPlanningAction[] = [];
  const seenVersions = new Set<string>();

  for (const version of input.versions) {
    const identity = jiraVersionSourceIdentity(
      input.jiraCloudId,
      version.projectId,
      version.id,
    );
    if (seenVersions.has(identity.key)) continue;
    seenVersions.add(identity.key);
    const selection: JiraPlanningSelectionReason[] = ["configured_project"];
    actions.push(
      classifyAction(
        identity,
        selection,
        versionTarget(version),
        {
          kind: "version",
          jiraCloudId: input.jiraCloudId,
          projectId: version.projectId,
          projectKey: input.projectKey,
          versionId: version.id,
          name: version.name,
          description: version.description,
          startDate: version.startDate,
          releaseDate: version.releaseDate,
          released: version.released,
          archived: version.archived,
        },
        versionReport(version),
        input.existingReleases,
        input.existingSprints,
        ledgerBindings,
      ),
    );
  }

  const selectedSprints = new Map<
    string,
    {
      sprint: NormalizedJiraSprint;
      selection: Set<JiraPlanningSelectionReason>;
    }
  >();
  const selectSprint = (
    sprint: NormalizedJiraSprint,
    reason: JiraPlanningSelectionReason,
  ): void => {
    const identity = jiraSprintSourceIdentity(input.jiraCloudId, sprint.id);
    const current = selectedSprints.get(identity.key);
    if (current) {
      current.sprint = mergeSprint(current.sprint, sprint);
      current.selection.add(reason);
      return;
    }
    selectedSprints.set(identity.key, {
      sprint,
      selection: new Set([reason]),
    });
  };
  for (const sprint of input.issueSprints)
    selectSprint(sprint, "issue_reference");
  for (const catalog of input.configuredBoards) {
    for (const sprint of catalog.sprints)
      selectSprint(sprint, "configured_board");
  }

  for (const { sprint, selection: selectedBy } of selectedSprints.values()) {
    const identity = jiraSprintSourceIdentity(input.jiraCloudId, sprint.id);
    const selection = [...selectedBy];
    const target = sprintTarget(sprint);
    actions.push(
      classifyAction(
        identity,
        selection,
        target,
        {
          kind: "sprint",
          jiraCloudId: input.jiraCloudId,
          sprintId: sprint.id,
          name: sprint.name,
          state: sprint.state,
          startDate: sprint.startDate,
          endDate: sprint.endDate,
          completeDate: sprint.completeDate,
          goal: sprint.goal,
          originBoardId: sprint.originBoardId,
        },
        sprintReport(sprint, target),
        input.existingReleases,
        input.existingSprints,
        ledgerBindings,
      ),
    );
  }

  const resolvedActions = markInPlanNameConflicts(actions);
  const summary: Record<JiraPlanningActionClassification, number> = {
    create: 0,
    reuse: 0,
    conflict: 0,
    unsupported: 0,
  };
  for (const action of resolvedActions) summary[action.classification] += 1;
  return deepFreeze({ actions: resolvedActions, summary });
};

export const resolveJiraPlanningActionTarget = (
  action: JiraPlanningAction,
  targetId: string,
): JiraPlanningTargetResolution => {
  if (
    action.classification === "conflict" ||
    action.classification === "unsupported"
  ) {
    throw new Error(`cannot resolve ${action.classification} planning action`);
  }
  return deepFreeze({
    sourceIdentity: action.sourceIdentity,
    targetKind: action.sourceIdentity.kind === "version" ? "release" : "sprint",
    targetId,
  });
};

export const buildJiraPlanningTargetMappings = (
  resolutions: readonly JiraPlanningTargetResolution[],
): JiraPlanningTargetMappings => {
  const releases: Record<string, string> = {};
  const sprints: Record<string, string> = {};
  for (const resolution of resolutions) {
    const target = resolution.targetKind === "release" ? releases : sprints;
    target[resolution.sourceIdentity.key] = resolution.targetId;
  }
  return deepFreeze({ releases, sprints });
};
