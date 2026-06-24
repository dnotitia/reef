/**
 * Field registry — the single canonical source for issue-field DISPLAY METADATA
 * (option ordering, the no-selection sentinel, and the en base label catalog),
 * derived from the enums in `metadata.ts`.
 *
 * This module is pure TS data: ZERO React, ZERO DOM, ZERO Tailwind, ZERO
 * next-intl. Presentation concerns that are not framework-agnostic (Tailwind
 * color classes, icons, JSX) live in web (`web/src/components/fields/fieldKit.ts`
 * + the leaf components).
 *
 * i18n contract (ADR-0001 / REEF-292): core owns the message KEYS (the enum
 * values) plus the en BASE catalog (`ISSUE_FIELD_MESSAGES_EN`) as pure data.
 * web composes that base into the next-intl `fields` namespace, resolves the
 * active locale (en/ko), and falls back to this base for any key a locale omits.
 * core does not resolve locales and never imports next-intl.
 *
 * Exhaustiveness is enforced at compile time: each catalog group `satisfies`
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

// --- Derived filter facets (filter, not issue-row columns) -------------
//
// `due` and `dependency` are board/list FILTER facets, not stored issue fields:
// they bucket an issue by deadline state and by blocker-graph direction. Their
// value unions are the canonical source in the web filter store
// (`IssueFilter.due` / `IssueFilter.dependencyFilter`); the options live here so
// the dropdown option leaves render from one place, exactly like the enum-backed
// facets above. These are plain typed consts (not Zod enums) so the filter
// schema, URL params, and persistence contract stay untouched.

export type DueFacet = "overdue" | "due_soon";
export const DUE_OPTIONS: readonly DueFacet[] = ["overdue", "due_soon"];

export type DependencyFacet = "blocked" | "blocking";
export const DEPENDENCY_OPTIONS: readonly DependencyFacet[] = [
  "blocked",
  "blocking",
];

// --- Sort control metadata (REEF-059) ---------------------------------------

export type SortOrder = "asc" | "desc";

/**
 * The intuitive default direction applied when a field is freshly selected:
 * dates and titles read forward (soonest / earliest / A→Z), ranked and recency
 * fields read strongest-first (priority high→low, newest, most points). The
 * direction toggle flips from here. Pure data (not a label) — stays in core.
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

// --- Field-name keys (REEF-301) ---------------------------------------------
//
// The stable key list for field-NAME labels — the display name of a field
// itself ("Assignee", "Due", "Priority"), distinct from the VALUE labels below
// (the "High" / "Low" a priority can take). These header words were duplicated
// as hardcoded literals across the issue detail rail, filter bar, report scope
// bar, new-issue dialog, and activity draft editor; the `name` catalog group
// gives those surfaces one shared source and removes the half-translated header
// REEF-292 left (a field's values localized but its name still English —
// REEF-298 AC2/AC4). Keyed by a field id rather than an enum value, so this
// group carries its own key list instead of deriving one from a schema enum.

export const FIELD_NAME_KEYS = [
  "type",
  "status",
  "priority",
  "severity",
  "labels",
  "assignee",
  "requester",
  "reporter",
  "due",
  "dependency",
  "sprint",
  "milestone",
  "release",
  "parent",
  // REEF-299: extra field names the issue-list columns + AI enrichment
  // descriptors need on top of the rail/filter/scope-bar set above.
  "id",
  "title",
  "description",
  "start",
  "updated",
  "points",
  "dependsOn",
  "blocks",
  "related",
  "externalRefs",
] as const;

export type FieldNameKey = (typeof FIELD_NAME_KEYS)[number];

// --- en base label catalog (ADR-0001 / REEF-292) ----------------------------
//
// The single source of the English field labels, keyed by enum value (the
// message key). web merges this into the next-intl `fields` namespace and
// resolves the active locale; missing locale keys fall back to these strings.
// Each group `satisfies` its enum `Record`, so a new enum member without a
// label is a compile error — the same exhaustiveness guarantee the old
// `Record<Enum, string>` maps carried.

export const ISSUE_FIELD_MESSAGES_EN = {
  status: {
    backlog: "Backlog",
    // `todo` is the committed-but-not-started stage, distinct from the
    // uncommitted `backlog` queue (REEF-109). Renamed from the older `open` key
    // so the stored value matches the "Todo" label (REEF-139).
    todo: "Todo",
    in_progress: "In Progress",
    in_review: "In Review",
    done: "Done",
    closed: "Closed",
  } satisfies Record<Status, string>,
  priority: {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
  } satisfies Record<Priority, string>,
  issueType: {
    epic: "Epic",
    story: "Story",
    task: "Task",
    bug: "Bug",
    spike: "Spike",
    chore: "Chore",
  } satisfies Record<IssueType, string>,
  severity: {
    blocker: "Blocker",
    critical: "Critical",
    major: "Major",
    minor: "Minor",
    trivial: "Trivial",
  } satisfies Record<Severity, string>,
  closedReason: {
    completed: "Completed",
    duplicate: "Duplicate",
    wont_fix: "Won't fix",
    invalid: "Invalid",
    stale: "Stale",
  } satisfies Record<ClosedReason, string>,
  closedReasonHint: {
    completed: "The work is finished and accepted.",
    duplicate: "Another issue already tracks this work.",
    wont_fix: "The team decided not to pursue it.",
    invalid: "The issue is not actionable as written.",
    stale: "The issue is no longer current.",
  } satisfies Record<ClosedReason, string>,
  due: {
    overdue: "Overdue",
    due_soon: "Due soon",
  } satisfies Record<DueFacet, string>,
  dependency: {
    blocked: "Blocked",
    blocking: "Blocking",
  } satisfies Record<DependencyFacet, string>,
  // Column names for the sort dropdown.
  sortField: {
    priority: "Priority",
    due_date: "Due date",
    start_date: "Start date",
    updated_at: "Updated",
    created_at: "Created",
    estimate_points: "Points",
    title: "Title",
  } satisfies Record<UserSortField, string>,
  // Field-aware natural-language direction labels (REEF-059): reads as the
  // user's intent rather than a generic asc/desc — "High → Low" for priority,
  // "Soonest" for a due date, "A → Z" for a title. Keyed `{field}.{order}`.
  sortDirection: {
    priority: { desc: "High → Low", asc: "Low → High" },
    due_date: { desc: "Latest", asc: "Soonest" },
    start_date: { desc: "Latest", asc: "Earliest" },
    created_at: { desc: "Newest", asc: "Oldest" },
    updated_at: { desc: "Newest", asc: "Oldest" },
    estimate_points: { desc: "Most", asc: "Fewest" },
    title: { desc: "Z → A", asc: "A → Z" },
  } satisfies Record<UserSortField, Record<SortOrder, string>>,
  // Field-NAME labels (REEF-301): the word that labels a field, keyed by field
  // id (see FIELD_NAME_KEYS). Shared by the property rail, filter bar, report
  // scope bar, create dialog, and activity draft editor.
  name: {
    type: "Type",
    status: "Status",
    priority: "Priority",
    severity: "Severity",
    labels: "Labels",
    assignee: "Assignee",
    requester: "Requester",
    reporter: "Reporter",
    due: "Due",
    dependency: "Dependency",
    sprint: "Sprint",
    milestone: "Milestone",
    release: "Release",
    parent: "Parent",
    id: "ID",
    title: "Title",
    description: "Description",
    start: "Start",
    updated: "Updated",
    points: "Points",
    dependsOn: "Depends on",
    blocks: "Blocks",
    related: "Related",
    externalRefs: "External references",
  } satisfies Record<FieldNameKey, string>,
};
