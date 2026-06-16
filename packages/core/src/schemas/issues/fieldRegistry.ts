/**
 * Field registry — the single canonical source for issue-field DISPLAY METADATA
 * (human labels, option ordering, the no-selection sentinel), derived from the
 * enums in `metadata.ts`.
 *
 * This module is pure TS data: ZERO React, ZERO DOM, ZERO Tailwind. Presentation
 * concerns that are not framework-agnostic (Tailwind color classes, icons, JSX)
 * live in web (`web/src/components/fields/fieldKit.ts` + the leaf components).
 *
 * Exhaustiveness is enforced at compile time: each `*_LABELS` map is typed as
 * `Record<Enum, string>`, so adding an enum member without a label is a type
 * error. Option arrays are derived from `Enum.options` so they can not drift
 * from the schema.
 */
import {
  ClosedReasonEnum,
  IssueTypeEnum,
  PriorityEnum,
  SeverityEnum,
  StatusEnum,
} from "./metadata";
import type {
  ClosedReason,
  IssueType,
  Priority,
  Severity,
  Status,
} from "./metadata";
import type { UserSortField } from "./requests";

export type { UserSortField };

/**
 * Canonical sentinel for "no value selected" in form controls and enrichment.
 * Replaces the previously duplicated `NO_PRIORITY` / `NO_SELECTION` constants.
 */
export const NO_SELECTION = "__none__" as const;

// --- Option arrays (derived from the schema enums; does not drift) ------------

export const STATUS_OPTIONS = StatusEnum.options;
export const PRIORITY_OPTIONS = PriorityEnum.options;

/**
 * The status options that appear as active workflow columns / groups on the
 * board and timeline. `backlog` is excluded: it is collected in the dedicated
 * backlog view, not surfaced as an active status column (REEF-109). Derived
 * from STATUS_OPTIONS so it can not drift from the enum.
 */
export const WORKFLOW_STATUS_OPTIONS: readonly Status[] = STATUS_OPTIONS.filter(
  (s) => s !== "backlog",
);
export const ISSUE_TYPE_OPTIONS = IssueTypeEnum.options;
export const SEVERITY_OPTIONS = SeverityEnum.options;
export const CLOSED_REASON_OPTIONS = ClosedReasonEnum.options;

// --- Human-readable labels (exhaustive over each enum) ----------------------

export const STATUS_LABELS: Record<Status, string> = {
  backlog: "Backlog",
  // `todo` is the committed-but-not-started stage, distinct from the uncommitted
  // `backlog` queue (REEF-109). Renamed from the older `open` key so the stored
  // value matches the "Todo" label (REEF-139).
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  closed: "Closed",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  epic: "Epic",
  story: "Story",
  task: "Task",
  bug: "Bug",
  spike: "Spike",
  chore: "Chore",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  blocker: "Blocker",
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  trivial: "Trivial",
};

export const CLOSED_REASON_LABELS: Record<ClosedReason, string> = {
  completed: "Completed",
  duplicate: "Duplicate",
  wont_fix: "Won't fix",
  invalid: "Invalid",
  stale: "Stale",
};

export const CLOSED_REASON_HINTS: Record<ClosedReason, string> = {
  completed: "The work is finished and accepted.",
  duplicate: "Another issue already tracks this work.",
  wont_fix: "The team decided not to pursue it.",
  invalid: "The issue is not actionable as written.",
  stale: "The issue is no longer current.",
};

// --- Derived filter facets (filter, not issue-row columns) -------------
//
// `due` and `dependency` are board/list FILTER facets, not stored issue fields:
// they bucket an issue by deadline state and by blocker-graph direction. Their
// value unions are the canonical source in the web filter store
// (`IssueFilter.due` / `IssueFilter.dependencyFilter`); the labels/options live
// here so the dropdown option leaves render from one place, exactly like the
// enum-backed facets above. These are plain typed consts (not Zod enums) so the
// filter schema, URL params, and persistence contract stay untouched.

export type DueFacet = "overdue" | "due_soon";
export const DUE_OPTIONS: readonly DueFacet[] = ["overdue", "due_soon"];
export const DUE_LABELS: Record<DueFacet, string> = {
  overdue: "Overdue",
  due_soon: "Due soon",
};

export type DependencyFacet = "blocked" | "blocking";
export const DEPENDENCY_OPTIONS: readonly DependencyFacet[] = [
  "blocked",
  "blocking",
];
export const DEPENDENCY_LABELS: Record<DependencyFacet, string> = {
  blocked: "Blocked",
  blocking: "Blocking",
};

// --- Sort control metadata (REEF-059) ---------------------------------------
//
// Display metadata for the shared board/list sort control. Pure data, derived
// from `USER_SORT_FIELDS` so the label map can not drift from the schema:
// `Record<UserSortField, string>` makes a missing label a compile error.

export type SortOrder = "asc" | "desc";

/** Human-readable column names for the sort dropdown (exhaustive). */
export const SORT_FIELD_LABELS: Record<UserSortField, string> = {
  priority: "Priority",
  due_date: "Due date",
  start_date: "Start date",
  updated_at: "Updated",
  created_at: "Created",
  estimate_points: "Points",
  title: "Title",
};

/**
 * Field-aware natural-language direction label (REEF-059). Reads as the user's
 * intent rather than a generic asc/desc — "High → Low" for priority, "Soonest"
 * for a due date, "A → Z" for a title. Exhaustive over `UserSortField`: adding a
 * sort field without a case is a compile error (no `default`).
 */
export function directionLabel(field: UserSortField, order: SortOrder): string {
  switch (field) {
    case "priority":
      return order === "desc" ? "High → Low" : "Low → High";
    case "due_date":
      return order === "desc" ? "Latest" : "Soonest";
    case "start_date":
      return order === "desc" ? "Latest" : "Earliest";
    case "created_at":
    case "updated_at":
      return order === "desc" ? "Newest" : "Oldest";
    case "estimate_points":
      return order === "desc" ? "Most" : "Fewest";
    case "title":
      return order === "desc" ? "Z → A" : "A → Z";
  }
}

/**
 * The intuitive default direction applied when a field is freshly selected:
 * dates and titles read forward (soonest / earliest / A→Z), ranked and recency
 * fields read strongest-first (priority high→low, newest, most points). The
 * direction toggle flips from here.
 */
export function naturalSortOrder(field: UserSortField): SortOrder {
  switch (field) {
    case "due_date":
    case "start_date":
    case "title":
      return "asc";
    default:
      return "desc";
  }
}
