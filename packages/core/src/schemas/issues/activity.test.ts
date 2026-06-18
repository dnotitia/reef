import { describe, expect, it } from "vitest";
import {
  ACTIVITY_EVENT_ASSIGNEE_CHANGE,
  ACTIVITY_EVENT_IMPL_REF_LINKED,
  ACTIVITY_EVENT_PLANNING_LINK,
  ACTIVITY_EVENT_PRIORITY_CHANGE,
  ACTIVITY_EVENT_STATUS_CHANGE,
  ActivityEventSchema,
  AssigneeChangePayloadSchema,
  ImplRefLinkedPayloadSchema,
  PlanningLinkPayloadSchema,
  PriorityChangePayloadSchema,
  StatusChangePayloadSchema,
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
        event_type: "title_change",
        payload: { from: "a", to: "b" },
      }),
    ).toThrow();
  });
});
