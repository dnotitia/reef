// @vitest-environment node
import type { ActivityEvent, Comment, IssueMetadata } from "@reef/core";
import { describe, expect, it } from "vitest";
import {
  buildEntries,
  buildTimeline,
  collapseRuns,
  reconstructEvents,
} from "./timelineModel";

function makeIssue(overrides: Partial<IssueMetadata> = {}): IssueMetadata {
  return {
    id: "REEF-001",
    title: "Demo",
    status: "in_progress",
    created_at: "2026-06-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-06-10T00:00:00.000Z",
    updated_by: "bob",
    ...overrides,
  };
}

function comment(id: string, at: string): Comment {
  return {
    id,
    reef_id: "REEF-001",
    body: `body ${id}`,
    author: "alice",
    created_at: at,
    edited_at: null,
  };
}

function activity(
  id: string,
  at: string,
  from: ActivityEvent["payload"]["from"],
  to: ActivityEvent["payload"]["to"],
): ActivityEvent {
  return {
    id,
    reef_id: "REEF-001",
    event_type: "status_change",
    event_key: `status_change:${from}->${to}@${at}`,
    payload: { from, to },
    actor: "bob",
    at,
    source: null,
  };
}

describe("buildEntries — merge-sort (AC1)", () => {
  it("interleaves comments and activity ascending by timestamp", () => {
    const issue = makeIssue({ created_at: "2026-06-01T00:00:00.000Z" });
    const comments = [
      comment("c-late", "2026-06-05T00:00:00.000Z"),
      comment("c-early", "2026-06-02T00:00:00.000Z"),
    ];
    const events = [
      activity("a1", "2026-06-03T00:00:00.000Z", "todo", "in_progress"),
    ];

    const entries = buildEntries(comments, events, issue);
    const ats = entries.map((e) => e.at);
    expect(ats).toEqual([...ats].sort());

    // created (reconstructed) is first; the two comments and the activity event
    // fall in time order between/after it.
    expect(entries[0]).toMatchObject({ type: "system" });
    expect(
      entries.map((e) => (e.type === "comment" ? e.comment.id : e.event.id)),
    ).toEqual(["created", "c-early", "a1", "c-late"]);
  });
});

describe("reconstructEvents (AC5)", () => {
  it("always emits a created event and one delivery per implementation_ref", () => {
    const issue = makeIssue({
      implementation_refs: [
        {
          type: "pull_request",
          repo: "o/r",
          ref: "25",
          actor: "carol",
          detected_at: "2026-06-08T00:00:00.000Z",
        },
      ],
    });
    const events = reconstructEvents(issue, []);
    expect(events.find((e) => e.kind === "created")).toBeTruthy();
    const delivery = events.find((e) => e.kind === "delivery");
    expect(delivery).toMatchObject({
      kind: "delivery",
      actor: "carol",
      at: "2026-06-08T00:00:00.000Z",
    });
  });

  it("reconstructs a closed event with its reason when the issue is closed", () => {
    const issue = makeIssue({
      status: "closed",
      closed_at: "2026-06-09T00:00:00.000Z",
      closed_reason: "completed",
      last_status_change: "2026-06-09T00:00:00.000Z",
    });
    const closed = reconstructEvents(issue, []).find(
      (e) => e.kind === "closed",
    );
    expect(closed).toMatchObject({
      kind: "closed",
      reason: "completed",
      at: "2026-06-09T00:00:00.000Z",
    });
  });

  it("drops the current-status fallback when activity already logged that transition (activity wins)", () => {
    const issue = makeIssue({
      status: "in_progress",
      last_status_change: "2026-06-04T00:00:00.000Z",
    });
    const logged = [
      activity("a1", "2026-06-04T00:00:00.000Z", "todo", "in_progress"),
    ];

    // With the transition logged, no reconstructed current-status event.
    const withLog = reconstructEvents(issue, logged);
    expect(withLog.some((e) => e.id === "current-status")).toBe(false);

    // Without any activity, the fallback fills in the current status.
    const withoutLog = reconstructEvents(issue, []);
    expect(withoutLog.find((e) => e.id === "current-status")).toMatchObject({
      kind: "status_change",
      from: null,
      to: "in_progress",
    });
  });

  it("does not duplicate the created event when the current status coincides with creation", () => {
    const issue = makeIssue({
      status: "todo",
      created_at: "2026-06-01T00:00:00.000Z",
      last_status_change: "2026-06-01T00:00:00.000Z",
    });
    const events = reconstructEvents(issue, []);
    expect(events.some((e) => e.id === "current-status")).toBe(false);
    expect(events.filter((e) => e.kind === "created")).toHaveLength(1);
  });
});

describe("collapseRuns (AC3)", () => {
  const sys = (
    id: string,
    at: string,
  ): ReturnType<typeof buildEntries>[number] => ({
    type: "system",
    at,
    event: {
      id,
      at,
      actor: "bob",
      kind: "status_change",
      from: "todo",
      to: "in_progress",
      source: null,
    },
  });

  it("folds a run of ≥3 consecutive status changes into one collapsed entry", () => {
    const entries = collapseRuns([
      sys("s1", "2026-06-02T00:00:00.000Z"),
      sys("s2", "2026-06-03T00:00:00.000Z"),
      sys("s3", "2026-06-04T00:00:00.000Z"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "collapsed" });
    expect((entries[0] as { events: unknown[] }).events).toHaveLength(3);
  });

  it("leaves runs of 1–2 status changes expanded, and never folds across a comment", () => {
    const entries = collapseRuns([
      sys("s1", "2026-06-02T00:00:00.000Z"),
      {
        type: "comment",
        at: "2026-06-03T00:00:00.000Z",
        comment: comment("c1", "2026-06-03T00:00:00.000Z"),
      },
      sys("s2", "2026-06-04T00:00:00.000Z"),
      sys("s3", "2026-06-05T00:00:00.000Z"),
    ]);
    // s1 alone (1) + comment + s2,s3 (2) — none reaches the threshold.
    expect(entries.every((e) => e.type !== "collapsed")).toBe(true);
    expect(entries).toHaveLength(4);
  });
});

describe("buildTimeline — full pipeline (AC1 + AC3 + AC5)", () => {
  it("merges, dedupes, and collapses into a single feed", () => {
    const issue = makeIssue({
      status: "in_review",
      created_at: "2026-06-01T00:00:00.000Z",
      last_status_change: "2026-06-06T00:00:00.000Z",
    });
    const comments = [comment("c1", "2026-06-02T00:00:00.000Z")];
    const events = [
      activity("a1", "2026-06-03T00:00:00.000Z", "todo", "in_progress"),
      activity("a2", "2026-06-04T00:00:00.000Z", "in_progress", "in_review"),
      activity("a3", "2026-06-05T00:00:00.000Z", "in_review", "in_progress"),
      activity("a4", "2026-06-06T00:00:00.000Z", "in_progress", "in_review"),
    ];

    const timeline = buildTimeline(comments, events, issue);
    // created, comment(c1), then the 4 activity events collapse (run ≥3).
    const kinds = timeline.map((e) => e.type);
    expect(kinds).toEqual(["system", "comment", "collapsed"]);
    // a4 logged the transition to the current status → no current-status dup.
    const flat = JSON.stringify(timeline);
    expect(flat).not.toContain("current-status");
  });
});
