/**
 * Planning-field display metadata — option ordering plus the en base label
 * catalog for the planning enums (planning kind + sprint / milestone / release
 * status), derived from the enums in `catalog.ts`.
 *
 * Pure TS data: ZERO React, ZERO DOM, ZERO Tailwind, ZERO next-intl — mirrors
 * the issue `fieldRegistry` split (REEF-018). Tailwind color classes live in web
 * (`web/src/components/fields/planningFieldKit.ts`).
 *
 * i18n contract (ADR-0001 / REEF-292): core owns the message KEYS (the enum
 * values) plus the en BASE catalog (`PLANNING_FIELD_MESSAGES_EN`) as pure data;
 * web composes it into the next-intl `fields.planning` namespace and resolves
 * the active locale. Exhaustiveness is compile-time enforced: each catalog group
 * `satisfies` its enum `Record`, so adding an enum member without a label is a
 * type error. Option arrays are derived from `Enum.options` so they do not
 * drift.
 */
import {
  MilestoneStatusEnum,
  ReleaseStatusEnum,
  SprintStatusEnum,
} from "./catalog";

export type SprintStatus = (typeof SprintStatusEnum.options)[number];
export type MilestoneStatus = (typeof MilestoneStatusEnum.options)[number];
export type ReleaseStatus = (typeof ReleaseStatusEnum.options)[number];

// --- Planning kind (the catalog dimension itself) ---------------------------
// The three planning dimensions a `PlanningCatalog` holds. This is the single
// canonical source for the kind keys, so every surface (planning page,
// comboboxes, board card, list headers, the `PlanningKindIcon` glyph leaf)
// speaks one vocabulary — the same role status keys play for issues. Pure data:
// the glyph mapping lives in web (`PlanningKindIcon`), the human labels in the
// en catalog below.

export const PLANNING_KINDS = ["sprints", "milestones", "releases"] as const;
export type PlanningKind = (typeof PLANNING_KINDS)[number];

// --- Option arrays (derived from the schema enums; does not drift) ------------

export const SPRINT_STATUS_OPTIONS = SprintStatusEnum.options;
export const MILESTONE_STATUS_OPTIONS = MilestoneStatusEnum.options;
export const RELEASE_STATUS_OPTIONS = ReleaseStatusEnum.options;

// --- en base label catalog (ADR-0001 / REEF-292) ----------------------------
//
// English planning labels keyed by enum value (the message key). web merges this
// into the next-intl `fields.planning` namespace and resolves the active locale;
// missing locale keys fall back to these strings. Each group `satisfies` its
// enum `Record`, so a new enum member without a label is a compile error.

export const PLANNING_FIELD_MESSAGES_EN = {
  // Plural labels — the planning page's kind tabs.
  kind: {
    sprints: "Sprints",
    milestones: "Milestones",
    releases: "Releases",
  } satisfies Record<PlanningKind, string>,
  // Singular labels — a single field/option/glyph for one kind.
  kindSingular: {
    sprints: "Sprint",
    milestones: "Milestone",
    releases: "Release",
  } satisfies Record<PlanningKind, string>,
  sprintStatus: {
    planned: "Planned",
    active: "Active",
    closed: "Closed",
  } satisfies Record<SprintStatus, string>,
  milestoneStatus: {
    open: "Open",
    closed: "Closed",
  } satisfies Record<MilestoneStatus, string>,
  releaseStatus: {
    planned: "Planned",
    in_progress: "In Progress",
    released: "Released",
  } satisfies Record<ReleaseStatus, string>,
};
