import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import {
  ImplementationRefTypeEnum,
  PriorityEnum,
  StatusEnum,
} from "./metadata";

/**
 * Issue activity log (REEF-063 / REEF-125 / REEF-126).
 *
 * An activity event is an immutable `reef_activity` row recording something that
 * happened to an issue — the Jira changelog / Linear IssueHistory equivalent.
 * REEF-063 shipped the MVP with a single kind, `status_change`. REEF-126 widens
 * the log to the rest of the high-signal field changes — assignee, priority,
 * planning links (milestone/sprint/release), and delivery refs — by making
 * `payload` a discriminated union keyed on `event_type`. REEF-277 completes the
 * Linear IssueHistory parity set — title, labels, due date, estimate, parent,
 * relations (depends_on/blocks/related_to), and archive — so the rest of the
 * editable high-signal fields leave a trace too. The timeline render that
 * consumes the union is REEF-064 / REEF-276.
 *
 * Storage shape (REEF-125 provisioned the table): every event row carries
 *   reef_id    — the issue the event belongs to
 *   event_type — which kind of change this row records (the discriminator)
 *   event_key  — idempotency key; the same logical change retried carries the
 *                same key so a best-effort append does not double a row
 *   payload    — event-specific data (e.g. `{ from, to }` for a status change)
 *   meta       — reef-semantic audit (actor, event time, trigger source), NOT
 *                akb's auto `created_by`/`created_at` (REEF-125 decision)
 */
export const ACTIVITY_EVENT_STATUS_CHANGE = "status_change";
/** A reassignment: `assigned_to` moved from one actor (or none) to another. */
export const ACTIVITY_EVENT_ASSIGNEE_CHANGE = "assignee_change";
/** A priority change: `priority` moved between levels (or to/from unset). */
export const ACTIVITY_EVENT_PRIORITY_CHANGE = "priority_change";
/** A planning link change: a milestone/sprint/release attach or detach. */
export const ACTIVITY_EVENT_PLANNING_LINK = "planning_link";
/** A delivery ref (PR/commit/branch) was linked to the issue. */
export const ACTIVITY_EVENT_IMPL_REF_LINKED = "impl_ref_linked";
/** A title edit: the issue `title` moved from one string to another (REEF-277). */
export const ACTIVITY_EVENT_TITLE_CHANGE = "title_change";
/** A labels edit: tags added and/or removed from the issue, a set change (REEF-277). */
export const ACTIVITY_EVENT_LABELS_CHANGE = "labels_change";
/** A due-date edit: `due_date` moved, or was set/cleared (REEF-277). */
export const ACTIVITY_EVENT_DUE_DATE_CHANGE = "due_date_change";
/** An estimate edit: `estimate_points` moved, or was set/cleared (REEF-277). */
export const ACTIVITY_EVENT_ESTIMATE_CHANGE = "estimate_change";
/** A parent edit: `parent_id` moved, or was set/cleared (REEF-277). */
export const ACTIVITY_EVENT_PARENT_CHANGE = "parent_change";
/** A relation edit: depends_on/blocks/related_to ids added and/or removed (REEF-277). */
export const ACTIVITY_EVENT_RELATION_CHANGE = "relation_change";
/** An archive edit: the issue was archived or restored (REEF-277). */
export const ACTIVITY_EVENT_ARCHIVED_CHANGE = "archived_change";

/** Which planning dimension a `planning_link` event records. */
export const PlanningLinkFieldEnum = z.enum(["milestone", "sprint", "release"]);
export type PlanningLinkField = z.infer<typeof PlanningLinkFieldEnum>;

/** Which relation dimension a `relation_change` event records (REEF-277). */
export const RelationFieldEnum = z.enum(["depends_on", "blocks", "related_to"]);
export type RelationField = z.infer<typeof RelationFieldEnum>;

/** `reef_activity.payload` for a `status_change` event: the from→to transition. */
export const StatusChangePayloadSchema = z.object({
  from: StatusEnum,
  to: StatusEnum,
});
export type StatusChangePayload = z.infer<typeof StatusChangePayloadSchema>;

/**
 * `assignee_change` payload. `assigned_to` is nullable (an issue may be
 * unassigned), so both ends are `string | null`: a claim is `null → alice`, a
 * hand-off `alice → bob`, an un-assign `alice → null`.
 */
export const AssigneeChangePayloadSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type AssigneeChangePayload = z.infer<typeof AssigneeChangePayloadSchema>;

/** `priority_change` payload. Nullable both ends — priority may be unset. */
export const PriorityChangePayloadSchema = z.object({
  from: PriorityEnum.nullable(),
  to: PriorityEnum.nullable(),
});
export type PriorityChangePayload = z.infer<typeof PriorityChangePayloadSchema>;

/**
 * `planning_link` payload. `field` names which planning dimension moved so a
 * single event_type covers all three id columns; `from`/`to` are the planning
 * ids (nullable — a detach is `id → null`, an attach `null → id`).
 */
export const PlanningLinkPayloadSchema = z.object({
  field: PlanningLinkFieldEnum,
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type PlanningLinkPayload = z.infer<typeof PlanningLinkPayloadSchema>;

/**
 * `impl_ref_linked` payload. Unlike the other events this is a set addition, not
 * a from→to mutation: a delivery ref was attached to the issue. The payload
 * names the linked ref (`ref_type`/`ref`/`repo`) — the same identity that
 * de-dupes `implementation_refs` by `type:repo:ref`. One event per newly-linked
 * ref; an update that re-writes an unchanged refs array emits nothing.
 */
export const ImplRefLinkedPayloadSchema = z.object({
  ref_type: ImplementationRefTypeEnum,
  ref: z.string().min(1, "impl ref is required"),
  repo: z.string().nullable(),
});
export type ImplRefLinkedPayload = z.infer<typeof ImplRefLinkedPayloadSchema>;

/**
 * `title_change` payload (REEF-277). The issue title is a required non-empty
 * string, so both ends carry the human title text — a rename, not an
 * attach/detach.
 */
export const TitleChangePayloadSchema = z.object({
  from: z.string(),
  to: z.string(),
});
export type TitleChangePayload = z.infer<typeof TitleChangePayloadSchema>;

/**
 * The set-change shape shared by `labels_change` and `relation_change`
 * (REEF-277): the ids `added` and `removed` in one save. Labels and relations
 * are unordered sets, so the diff is two collections rather than a from→to
 * mutation — generalizing the `impl_ref_linked` set-addition precedent to
 * removals too. The producer emits an event just when at least one side is
 * non-empty.
 */
const stringSetChangeShape = {
  added: z.array(z.string()),
  removed: z.array(z.string()),
} as const;

/** `labels_change` payload: the labels added and/or removed in one save (REEF-277). */
export const LabelsChangePayloadSchema = z.object({ ...stringSetChangeShape });
export type LabelsChangePayload = z.infer<typeof LabelsChangePayloadSchema>;

/**
 * `relation_change` payload (REEF-277). `relation` names which relation
 * dimension moved so a single event_type covers all three id arrays — the
 * `planning_link` precedent that folds milestone/sprint/release behind one
 * `field`. `added`/`removed` are the reef ids linked/unlinked in this save.
 */
export const RelationChangePayloadSchema = z.object({
  relation: RelationFieldEnum,
  ...stringSetChangeShape,
});
export type RelationChangePayload = z.infer<typeof RelationChangePayloadSchema>;

/** `due_date_change` payload (REEF-277). Nullable both ends — a due date may be unset. */
export const DueDateChangePayloadSchema = z.object({
  from: IsoDateFieldSchema.nullable(),
  to: IsoDateFieldSchema.nullable(),
});
export type DueDateChangePayload = z.infer<typeof DueDateChangePayloadSchema>;

/** `estimate_change` payload (REEF-277). Nullable both ends — an estimate may be unset. */
export const EstimateChangePayloadSchema = z.object({
  from: z.number().nonnegative().nullable(),
  to: z.number().nonnegative().nullable(),
});
export type EstimateChangePayload = z.infer<typeof EstimateChangePayloadSchema>;

/**
 * `parent_change` payload (REEF-277). Nullable both ends — the parent reef id
 * (REEF-012), or null on an attach (`null → id`) / detach (`id → null`).
 */
export const ParentChangePayloadSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type ParentChangePayload = z.infer<typeof ParentChangePayloadSchema>;

/**
 * `archived_change` payload (REEF-277). The archived flag flipping: archive is
 * `false → true`, restore is `true → false`.
 */
export const ArchivedChangePayloadSchema = z.object({
  from: z.boolean(),
  to: z.boolean(),
});
export type ArchivedChangePayload = z.infer<typeof ArchivedChangePayloadSchema>;

/** Every `reef_activity.event_type` value this release knows how to record. */
export const ACTIVITY_EVENT_TYPES = [
  ACTIVITY_EVENT_STATUS_CHANGE,
  ACTIVITY_EVENT_ASSIGNEE_CHANGE,
  ACTIVITY_EVENT_PRIORITY_CHANGE,
  ACTIVITY_EVENT_PLANNING_LINK,
  ACTIVITY_EVENT_IMPL_REF_LINKED,
  ACTIVITY_EVENT_TITLE_CHANGE,
  ACTIVITY_EVENT_LABELS_CHANGE,
  ACTIVITY_EVENT_DUE_DATE_CHANGE,
  ACTIVITY_EVENT_ESTIMATE_CHANGE,
  ACTIVITY_EVENT_PARENT_CHANGE,
  ACTIVITY_EVENT_RELATION_CHANGE,
  ACTIVITY_EVENT_ARCHIVED_CHANGE,
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

/**
 * `reef_activity.meta` json contract. akb auto-injects `id`/`created_by`/
 * `created_at`/`updated_at` on the row, but those are the akb auth principal and
 * akb bookkeeping — the reef-semantic actor, the event's own timestamp, and its
 * trigger provenance live here in `meta` (mirrors `CommentMetaSchema`).
 *
 *   actor  — reef semantic actor (akb username) who caused the event.
 *   at     — ISO-8601 event time. For a status change this is the issue's
 *            `last_status_change`; for the other field events it is the update's
 *            `updated_at`, so every event from one save shares one timestamp.
 *   source — trigger provenance (e.g. `ai-agent:status_change:<id>`), or null.
 */
export const ActivityEventMetaSchema = z.object({
  actor: z.string().min(1, "activity actor is required"),
  at: IsoDateFieldSchema,
  source: z.string().nullable().default(null),
});

/**
 * An activity event as it crosses the core boundary. Wire fields are snake_case
 * (the akb row shape); `id` is the akb-assigned uuid; `actor`/`at`/`source` are
 * projected from `meta`, not from akb's auto columns. `payload` is a
 * discriminated union keyed on `event_type` (REEF-126) — a consumer narrows on
 * `event_type` to read the matching payload. The base fields are shared by every
 * variant; `event_type` + `payload` differ.
 */
const activityEventBaseShape = {
  id: z.string().min(1, "activity id is required"),
  reef_id: z.string().min(1, "reef_id is required"),
  event_key: z.string().min(1, "event_key is required"),
  actor: z.string().min(1, "activity actor is required"),
  at: IsoDateFieldSchema,
  source: z.string().nullable().default(null),
} as const;

export const ActivityEventSchema = z.discriminatedUnion("event_type", [
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_STATUS_CHANGE),
    payload: StatusChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_ASSIGNEE_CHANGE),
    payload: AssigneeChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_PRIORITY_CHANGE),
    payload: PriorityChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_PLANNING_LINK),
    payload: PlanningLinkPayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_IMPL_REF_LINKED),
    payload: ImplRefLinkedPayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_TITLE_CHANGE),
    payload: TitleChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_LABELS_CHANGE),
    payload: LabelsChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_DUE_DATE_CHANGE),
    payload: DueDateChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_ESTIMATE_CHANGE),
    payload: EstimateChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_PARENT_CHANGE),
    payload: ParentChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_RELATION_CHANGE),
    payload: RelationChangePayloadSchema,
  }),
  z.object({
    ...activityEventBaseShape,
    event_type: z.literal(ACTIVITY_EVENT_ARCHIVED_CHANGE),
    payload: ArchivedChangePayloadSchema,
  }),
]);
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/** The payload union across every event kind (the `payload` of `ActivityEvent`). */
export type ActivityEventPayload = ActivityEvent["payload"];
