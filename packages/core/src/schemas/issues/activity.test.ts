import { describe, expect, it } from "vitest";
import {
  ACTIVITY_EVENT_ARCHIVED_CHANGE,
  ACTIVITY_EVENT_ASSIGNEE_CHANGE,
  ACTIVITY_EVENT_ATTACHMENT_ADDED,
  ACTIVITY_EVENT_ATTACHMENT_REMOVED,
  ACTIVITY_EVENT_DUE_DATE_CHANGE,
  ACTIVITY_EVENT_ESTIMATE_CHANGE,
  ACTIVITY_EVENT_IMPL_REF_LINKED,
  ACTIVITY_EVENT_ISSUE_TYPE_CHANGE,
  ACTIVITY_EVENT_LABELS_CHANGE,
  ACTIVITY_EVENT_PARENT_CHANGE,
  ACTIVITY_EVENT_PLANNING_LINK,
  ACTIVITY_EVENT_PRIORITY_CHANGE,
  ACTIVITY_EVENT_RELATION_CHANGE,
  ACTIVITY_EVENT_START_DATE_CHANGE,
  ACTIVITY_EVENT_STATUS_CHANGE,
  ACTIVITY_EVENT_TITLE_CHANGE,
  ActivityEventSchema,
  ArchivedChangePayloadSchema,
  AssigneeChangePayloadSchema,
  AttachmentAddedPayloadSchema,
  AttachmentRemovedPayloadSchema,
  DueDateChangePayloadSchema,
  EstimateChangePayloadSchema,
  ImplRefLinkedPayloadSchema,
  IssueTypeChangePayloadSchema,
  LabelsChangePayloadSchema,
  ParentChangePayloadSchema,
  PlanningLinkPayloadSchema,
  PriorityChangePayloadSchema,
  RelationChangePayloadSchema,
  StartDateChangePayloadSchema,
  StatusChangePayloadSchema,
  TitleChangePayloadSchema,
} from "./activity";

const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  reef_id: "REEF-126",
  event_key: "k",
  actor: "alice",
  at: "2026-06-18T01:00:00.000Z",
  source: null,
};

describe("activity payload schemas (REEF-126)", () => {
  it("status_change carries the from→to status transition", () => {
    expect(
      StatusChangePayloadSchema.parse({ from: "todo", to: "in_progress" }),
    ).toEqual({ from: "todo", to: "in_progress" });
    expect(() =>
      StatusChangePayloadSchema.parse({ from: "todo", to: "nope" }),
    ).toThrow();
  });

  it("assignee_change is nullable on both ends (claim, hand-off, un-assign)", () => {
    expect(
      AssigneeChangePayloadSchema.parse({ from: null, to: "alice" }),
    ).toEqual({ from: null, to: "alice" });
    expect(
      AssigneeChangePayloadSchema.parse({ from: "alice", to: null }),
    ).toEqual({ from: "alice", to: null });
  });

  it("priority_change accepts the priority enum or null, rejects junk", () => {
    expect(
      PriorityChangePayloadSchema.parse({ from: "high", to: null }),
    ).toEqual({ from: "high", to: null });
    expect(() =>
      PriorityChangePayloadSchema.parse({ from: "urgent", to: "low" }),
    ).toThrow();
  });

  it("planning_link names the dimension and its id transition", () => {
    expect(
      PlanningLinkPayloadSchema.parse({
        field: "sprint",
        from: null,
        to: "spr-3",
      }),
    ).toEqual({ field: "sprint", from: null, to: "spr-3" });
    expect(() =>
      PlanningLinkPayloadSchema.parse({ field: "epic", from: null, to: "x" }),
    ).toThrow();
  });

  it("impl_ref_linked names the newly-linked ref", () => {
    expect(
      ImplRefLinkedPayloadSchema.parse({
        ref_type: "pull_request",
        ref: "42",
        repo: "dnotitia/reef",
      }),
    ).toEqual({ ref_type: "pull_request", ref: "42", repo: "dnotitia/reef" });
    expect(() =>
      ImplRefLinkedPayloadSchema.parse({ ref_type: "pull_request", ref: "" }),
    ).toThrow();
  });
});

describe("activity payload schemas (REEF-277)", () => {
  it("title_change carries both ends of the rename", () => {
    expect(TitleChangePayloadSchema.parse({ from: "Old", to: "New" })).toEqual({
      from: "Old",
      to: "New",
    });
  });

  it("labels_change carries added/removed collections", () => {
    expect(
      LabelsChangePayloadSchema.parse({ added: ["bug"], removed: ["chore"] }),
    ).toEqual({ added: ["bug"], removed: ["chore"] });
    // Either side may be empty (a pure add or pure remove).
    expect(
      LabelsChangePayloadSchema.parse({ added: [], removed: ["chore"] }),
    ).toEqual({ added: [], removed: ["chore"] });
  });

  it("due_date_change accepts an ISO date or null, rejects junk", () => {
    expect(
      DueDateChangePayloadSchema.parse({
        from: null,
        to: "2026-07-01T00:00:00.000Z",
      }),
    ).toEqual({ from: null, to: "2026-07-01T00:00:00.000Z" });
    expect(() =>
      DueDateChangePayloadSchema.parse({ from: "not-a-date", to: null }),
    ).toThrow();
  });

  it("estimate_change accepts a non-negative number or null, rejects negatives", () => {
    expect(EstimateChangePayloadSchema.parse({ from: 3, to: 0 })).toEqual({
      from: 3,
      to: 0,
    });
    expect(EstimateChangePayloadSchema.parse({ from: null, to: 5 })).toEqual({
      from: null,
      to: 5,
    });
    expect(() =>
      EstimateChangePayloadSchema.parse({ from: -1, to: null }),
    ).toThrow();
  });

  it("parent_change carries the reef-id transition, nullable both ends", () => {
    expect(
      ParentChangePayloadSchema.parse({ from: null, to: "REEF-012" }),
    ).toEqual({ from: null, to: "REEF-012" });
    expect(
      ParentChangePayloadSchema.parse({ from: "REEF-012", to: null }),
    ).toEqual({ from: "REEF-012", to: null });
  });

  it("relation_change names the dimension and its added/removed ids", () => {
    expect(
      RelationChangePayloadSchema.parse({
        relation: "depends_on",
        added: ["REEF-002"],
        removed: [],
      }),
    ).toEqual({ relation: "depends_on", added: ["REEF-002"], removed: [] });
    expect(() =>
      RelationChangePayloadSchema.parse({
        relation: "epic",
        added: [],
        removed: [],
      }),
    ).toThrow();
  });

  it("archived_change is a boolean flip", () => {
    expect(
      ArchivedChangePayloadSchema.parse({ from: false, to: true }),
    ).toEqual({ from: false, to: true });
    expect(() =>
      ArchivedChangePayloadSchema.parse({ from: "no", to: "yes" }),
    ).toThrow();
  });

  it("attachment payloads carry stable file identity and display metadata", () => {
    const payload = {
      attachment_id: "att-1",
      file_uri: "akb://reef/issues/file/file-1",
      filename: "screenshot.png",
      mime_type: "image/png",
      size_bytes: 42,
    };
    expect(AttachmentAddedPayloadSchema.parse(payload)).toEqual(payload);
    expect(AttachmentRemovedPayloadSchema.parse(payload)).toEqual(payload);
    expect(() =>
      AttachmentAddedPayloadSchema.parse({ ...payload, size_bytes: -1 }),
    ).toThrow();
  });

  it("validates issue-type and start-date migration events losslessly", () => {
    expect(
      IssueTypeChangePayloadSchema.parse({ from: "story", to: "bug" }),
    ).toEqual({ from: "story", to: "bug" });
    expect(() =>
      IssueTypeChangePayloadSchema.parse({ from: "Feature", to: "bug" }),
    ).toThrow();
    expect(
      StartDateChangePayloadSchema.parse({ from: null, to: "2026-07-21" }),
    ).toEqual({ from: null, to: "2026-07-21" });
    expect(() =>
      StartDateChangePayloadSchema.parse({ from: null, to: "tomorrow" }),
    ).toThrow();
  });
});

describe("ActivityEventSchema discriminated union (REEF-126)", () => {
  it("routes each event_type to its matching payload", () => {
    const cases = [
      {
        event_type: ACTIVITY_EVENT_STATUS_CHANGE,
        payload: { from: "todo", to: "done" },
      },
      {
        event_type: ACTIVITY_EVENT_ASSIGNEE_CHANGE,
        payload: { from: "alice", to: "bob" },
      },
      {
        event_type: ACTIVITY_EVENT_PRIORITY_CHANGE,
        payload: { from: null, to: "low" },
      },
      {
        event_type: ACTIVITY_EVENT_PLANNING_LINK,
        payload: { field: "milestone", from: null, to: "ms-1" },
      },
      {
        event_type: ACTIVITY_EVENT_IMPL_REF_LINKED,
        payload: { ref_type: "commit", ref: "abc123", repo: null },
      },
      {
        event_type: ACTIVITY_EVENT_TITLE_CHANGE,
        payload: { from: "Old", to: "New" },
      },
      {
        event_type: ACTIVITY_EVENT_LABELS_CHANGE,
        payload: { added: ["bug"], removed: [] },
      },
      {
        event_type: ACTIVITY_EVENT_DUE_DATE_CHANGE,
        payload: { from: null, to: "2026-07-01T00:00:00.000Z" },
      },
      {
        event_type: ACTIVITY_EVENT_ESTIMATE_CHANGE,
        payload: { from: 3, to: 5 },
      },
      {
        event_type: ACTIVITY_EVENT_PARENT_CHANGE,
        payload: { from: null, to: "REEF-012" },
      },
      {
        event_type: ACTIVITY_EVENT_RELATION_CHANGE,
        payload: { relation: "blocks", added: ["REEF-010"], removed: [] },
      },
      {
        event_type: ACTIVITY_EVENT_ARCHIVED_CHANGE,
        payload: { from: false, to: true },
      },
      {
        event_type: ACTIVITY_EVENT_ATTACHMENT_ADDED,
        payload: {
          attachment_id: "att-1",
          file_uri: "akb://reef/issues/file/file-1",
          filename: "screenshot.png",
          mime_type: "image/png",
          size_bytes: 42,
        },
      },
      {
        event_type: ACTIVITY_EVENT_ATTACHMENT_REMOVED,
        payload: {
          attachment_id: "att-1",
          file_uri: "akb://reef/issues/file/file-1",
          filename: "screenshot.png",
          mime_type: "image/png",
          size_bytes: 42,
        },
      },
      {
        event_type: ACTIVITY_EVENT_ISSUE_TYPE_CHANGE,
        payload: { from: "story", to: "bug" },
      },
      {
        event_type: ACTIVITY_EVENT_START_DATE_CHANGE,
        payload: { from: null, to: "2026-07-21" },
      },
    ];
    for (const c of cases) {
      const parsed = ActivityEventSchema.parse({ ...BASE, ...c });
      expect(parsed.event_type).toBe(c.event_type);
      expect(parsed.payload).toEqual(c.payload);
    }
  });

  it("rejects a payload that does not match its event_type", () => {
    expect(() =>
      ActivityEventSchema.parse({
        ...BASE,
        event_type: ACTIVITY_EVENT_STATUS_CHANGE,
        // an assignee-shaped payload is not a valid status transition
        payload: { from: "alice", to: "bob" },
      }),
    ).toThrow();
  });

  it("rejects an unknown event_type (forward-compat: reader skips it)", () => {
    expect(() =>
      ActivityEventSchema.parse({
        ...BASE,
        // content_change (REEF-127, body diff) is a deliberately-unmodeled
        // future type — a clean stand-in for an event this release does not read.
        event_type: "content_change",
        payload: { from: "a", to: "b" },
      }),
    ).toThrow();
  });
});
