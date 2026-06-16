/**
 * Planning-field display metadata — human labels + option ordering for the
 * planning status enums (sprint / milestone / release), derived from the enums
 * in `catalog.ts`.
 *
 * Pure TS data: ZERO React, ZERO DOM, ZERO Tailwind — mirrors the issue
 * `fieldRegistry` split (REEF-018). Tailwind color classes live in web
 * (`web/src/components/fields/planningFieldKit.ts`).
 *
 * Exhaustiveness is compile-time enforced: each `*_LABELS` map is typed as
 * `Record<Enum, string>`, so adding an enum member without a label is a type
 * error. Option arrays are derived from `Enum.options` so they does not drift.
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
// canonical source for the kind keys and their human labels, so every surface
// (planning page, comboboxes, board card, list headers, the `PlanningKindIcon`
// glyph leaf) speaks one vocabulary — the same role `STATUS_LABELS` plays for
// status. Pure data: the glyph mapping lives in web (`PlanningKindIcon`).

export const PLANNING_KINDS = ["sprints", "milestones", "releases"] as const;
export type PlanningKind = (typeof PLANNING_KINDS)[number];

/** Plural labels — the planning page's kind tabs. */
export const PLANNING_KIND_LABELS: Record<PlanningKind, string> = {
  sprints: "Sprints",
  milestones: "Milestones",
  releases: "Releases",
};

/** Singular labels — a single field/option/glyph for one kind. */
export const PLANNING_KIND_SINGULAR: Record<PlanningKind, string> = {
  sprints: "Sprint",
  milestones: "Milestone",
  releases: "Release",
};

// --- Option arrays (derived from the schema enums; does not drift) ------------

export const SPRINT_STATUS_OPTIONS = SprintStatusEnum.options;
export const MILESTONE_STATUS_OPTIONS = MilestoneStatusEnum.options;
export const RELEASE_STATUS_OPTIONS = ReleaseStatusEnum.options;

// --- Human-readable labels (exhaustive over each enum) ----------------------

export const SPRINT_STATUS_LABELS: Record<SprintStatus, string> = {
  planned: "Planned",
  active: "Active",
  closed: "Closed",
};

export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  open: "Open",
  closed: "Closed",
};

export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  released: "Released",
};
