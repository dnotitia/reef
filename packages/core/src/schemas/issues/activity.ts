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
 * `payload` a discriminated union keyed on `event_type`. The timeline render
 * that consumes the union is REEF-064.
 *
 * Storage shape (REEF-125 provisioned the table): every event row carries
 *   reef_id    — the issue the event belongs to
 *   event_type — which kind of change this row records (the discriminator)
 *   event_key  — idempotency key; the same logical change retried carries the
 *                same key so a best-effort append never doubles a row
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

/** Which planning dimension a `planning_link` event records. */
export const PlanningLinkFieldEnum = z.enum(["milestone", "sprint", "release"]);
export type PlanningLinkField = z.infer<typeof PlanningLinkFieldEnum>;

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

/** Every `reef_activity.event_type` value this release knows how to record. */
export const ACTIVITY_EVENT_TYPES = [
  ACTIVITY_EVENT_STATUS_CHANGE,
  ACTIVITY_EVENT_ASSIGNEE_CHANGE,
  ACTIVITY_EVENT_PRIORITY_CHANGE,
  ACTIVITY_EVENT_PLANNING_LINK,
  ACTIVITY_EVENT_IMPL_REF_LINKED,
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
export type ActivityEventMeta = z.infer<typeof ActivityEventMetaSchema>;

/**
 * An activity event as it crosses the core boundary. Wire fields are snake_case
 * (the akb row shape); `id` is the akb-assigned uuid; `actor`/`at`/`source` are
 * projected from `meta`, never from akb's auto columns. `payload` is a
 * discriminated union keyed on `event_type` (REEF-126) — a consumer narrows on
 * `event_type` to read the matching payload. The base fields are shared by every
 * variant; only `event_type` + `payload` differ.
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
]);
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

/** The payload union across every event kind (the `payload` of `ActivityEvent`). */
export type ActivityEventPayload = ActivityEvent["payload"];

/**
 * An activity event projected for the cross-issue Activity feed (REEF-077): an
 * `ActivityEvent` (any kind) plus the owning issue's current `title`, joined in
 * at read time so the feed renders the issue link + title without an N+1 lookup
 * per event. `ActivityEventSchema` is a discriminated union (REEF-126), so the
 * title is attached via `.and` (intersection) rather than `.extend` — the result
 * still narrows on `event_type` to the matching payload.
 *
 * This is the vault-wide "what changed since you were last here" projection the
 * Activity hub merges with the AI review inbox — distinct from
 * `listIssueActivity`, which returns a single issue's full history for the
 * REEF-064 detail timeline.
 */
export const RecentActivityEventSchema = ActivityEventSchema.and(
  z.object({ issue_title: z.string().min(1, "issue_title is required") }),
);
export type RecentActivityEvent = z.infer<typeof RecentActivityEventSchema>;

/** `/api/activity/events` response — the vault-wide recent issue-change feed. */
export const RecentActivityResultSchema = z.object({
  events: z.array(RecentActivityEventSchema),
});
export type RecentActivityResult = z.infer<typeof RecentActivityResultSchema>;
