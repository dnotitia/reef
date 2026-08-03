import { describe, expect, it } from "vitest";
import { akbProjectNotifications, buildNotificationKey } from "../index";
import {
  makeAdapter,
  makeSqlQueryResponse,
  setupFetch,
} from "./akb.testSupport";

const ACTIVATED_AT = "2026-08-01T00:00:00.000Z";
const ACTIVITY_ID = "018f47a4-8e3b-7f62-a3d2-9876543210ab";
const COMMENT_ID = "018f47a4-8e3b-7f62-a3d2-9876543210ac";
const MALFORMED_ID = "018f47a4-8e3b-7f62-a3d2-9876543210ad";

function checkpoint(overrides: Record<string, unknown> = {}) {
  return {
    activated_at: ACTIVATED_AT,
    activity_cursor: null,
    comment_cursor: null,
    ...overrides,
  };
}

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTIVITY_ID,
    reef_id: "REEF-1",
    event_type: "status_change",
    event_key: "status_change:todo->in_progress@2026-08-01T00:01:00.000Z",
    meta: JSON.stringify({
      actor: "alice",
      at: "2026-08-01T00:01:00.000Z",
    }),
    ...overrides,
  };
}

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    reef_id: "REEF-1",
    meta: JSON.stringify({
      author: "dana",
      created_at: "2026-08-01T00:02:00.000Z",
    }),
    ...overrides,
  };
}

function subscriptionRow(
  subscriber: string,
  source: string,
  status: "active" | "muted" = "active",
) {
  return { subscriber, source, status };
}

function notificationRow(input: {
  recipient: string;
  sourceType: "activity" | "comment";
  sourceRef: string;
  eventType: string;
  actor: string;
  occurredAt: string;
}) {
  return {
    id: "018f47a4-8e3b-7f62-a3d2-9876543210ae",
    notification_key: buildNotificationKey({
      recipient: input.recipient,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
    }),
    recipient: input.recipient,
    reef_id: "REEF-1",
    source_type: input.sourceType,
    source_ref: input.sourceRef,
    event_type: input.eventType,
    actor: input.actor,
    occurred_at: input.occurredAt,
    state: "unread",
    read_at: null,
    archived_at: null,
    payload: JSON.stringify({
      source_type: input.sourceType,
      source_ref: input.sourceRef,
    }),
    meta: null,
  };
}

function response(items: Record<string, unknown>[]) {
  return { body: makeSqlQueryResponse(items, ["id"]) };
}

function sql(call: { init: RequestInit | undefined }): string {
  return JSON.parse(String(call.init?.body)).sql as string;
}

function project() {
  return akbProjectNotifications({
    adapter: makeAdapter(),
    vault: "reef-sample",
    now: () => new Date(ACTIVATED_AT),
  });
}

describe("notification projector", () => {
  it("records activation before reading either source and excludes prior history", async () => {
    const { calls } = setupFetch([
      response([]),
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([]),
      response([]),
    ]);

    await expect(project()).resolves.toMatchObject({
      activated: true,
      activity: { scanned: 0 },
      comment: { scanned: 0 },
    });

    expect(sql(calls[1] ?? {})).toContain("INSERT INTO reef_settings");
    expect(sql(calls[2] ?? {})).toContain(
      "meta->>'at' > '2026-08-01T00:00:00.000Z'",
    );
    expect(sql(calls[3] ?? {})).toContain(
      "meta->>'created_at' > '2026-08-01T00:00:00.000Z'",
    );
    expect(calls.map(sql).join("\n")).not.toContain("reef_notifications");
  });

  it("maps both sources without reading comment bodies and excludes muted and self recipients", async () => {
    const activity = activityRow();
    const comment = commentRow();
    const { calls } = setupFetch([
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([activity]),
      response([
        subscriptionRow("alice", "requester"),
        subscriptionRow("bob", "requester"),
        subscriptionRow("carol", "manual", "muted"),
        subscriptionRow("carol", "commenter"),
      ]),
      response([
        notificationRow({
          recipient: "bob",
          sourceType: "activity",
          sourceRef: String(activity.event_key),
          eventType: "status_change",
          actor: "alice",
          occurredAt: "2026-08-01T00:01:00.000Z",
        }),
      ]),
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([comment]),
      response([subscriptionRow("erin", "commenter")]),
      response([
        notificationRow({
          recipient: "erin",
          sourceType: "comment",
          sourceRef: COMMENT_ID,
          eventType: "comment_created",
          actor: "dana",
          occurredAt: "2026-08-01T00:02:00.000Z",
        }),
      ]),
      response([{ value: JSON.stringify(checkpoint()) }]),
    ]);

    await expect(project()).resolves.toMatchObject({
      activity: { fannedOut: 1, failed: false },
      comment: { fannedOut: 1, failed: false },
    });

    const statements = calls.map(sql);
    const notificationSql = statements.filter((statement) =>
      statement.includes("INSERT INTO reef_notifications"),
    );
    expect(notificationSql).toHaveLength(2);
    expect(notificationSql.join("\n")).toContain("'activity'");
    expect(notificationSql.join("\n")).toContain("'comment'");
    expect(notificationSql.join("\n")).not.toContain("comment body is private");
    expect(
      statements.find((statement) => statement.includes("reef_comments")),
    ).toContain("SELECT id, reef_id, meta");
    expect(
      statements.find((statement) => statement.includes("reef_comments")),
    ).not.toContain("body");
  });

  it("advances past malformed and no-recipient rows so later valid work is delivered", async () => {
    const malformed = activityRow({
      id: MALFORMED_ID,
      event_key: "",
      meta: JSON.stringify({
        actor: "alice",
        at: "2026-08-01T00:01:00.000Z",
      }),
    });
    const noRecipients = activityRow({
      id: COMMENT_ID,
      event_key: "status_change:empty@2026-08-01T00:02:00.000Z",
      meta: JSON.stringify({
        actor: "alice",
        at: "2026-08-01T00:02:00.000Z",
      }),
    });
    const valid = activityRow({
      event_key: "status_change:valid@2026-08-01T00:03:00.000Z",
      meta: JSON.stringify({
        actor: "alice",
        at: "2026-08-01T00:03:00.000Z",
      }),
    });
    const { calls } = setupFetch([
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([malformed, noRecipients, valid]),
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([]),
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([subscriptionRow("bob", "requester")]),
      response([
        notificationRow({
          recipient: "bob",
          sourceType: "activity",
          sourceRef: String(valid.event_key),
          eventType: "status_change",
          actor: "alice",
          occurredAt: "2026-08-01T00:03:00.000Z",
        }),
      ]),
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([]),
    ]);

    await expect(project()).resolves.toMatchObject({
      activity: {
        scanned: 3,
        skippedMalformed: 1,
        skippedNoRecipients: 1,
        fannedOut: 1,
      },
    });
    expect(
      calls.filter((call) =>
        sql(call).includes("INSERT INTO reef_notifications"),
      ),
    ).toHaveLength(1);
  });

  it("keeps a failed source checkpoint unchanged while the other source succeeds", async () => {
    const activity = activityRow();
    const comment = commentRow();
    const { calls } = setupFetch([
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([activity]),
      { status: 500, body: { detail: "subscription service failed" } },
      response([comment]),
      response([subscriptionRow("erin", "commenter")]),
      response([
        notificationRow({
          recipient: "erin",
          sourceType: "comment",
          sourceRef: COMMENT_ID,
          eventType: "comment_created",
          actor: "dana",
          occurredAt: "2026-08-01T00:02:00.000Z",
        }),
      ]),
      response([{ value: JSON.stringify(checkpoint()) }]),
    ]);

    await expect(project()).resolves.toMatchObject({
      activity: { failed: true, cursor: null },
      comment: { failed: false, fannedOut: 1 },
    });
    const checkpointSql = calls
      .map(sql)
      .filter((statement) => statement.includes("UPDATE reef_settings"));
    expect(checkpointSql).toHaveLength(1);
    expect(checkpointSql[0]).toContain("comment_cursor");
  });

  it("replays a partially completed fan-out with the same recipient identities", async () => {
    const activity = activityRow();
    const subscriptions = [
      subscriptionRow("bob", "requester"),
      subscriptionRow("carol", "commenter"),
    ];
    const bob = notificationRow({
      recipient: "bob",
      sourceType: "activity",
      sourceRef: String(activity.event_key),
      eventType: "status_change",
      actor: "alice",
      occurredAt: "2026-08-01T00:01:00.000Z",
    });
    const carol = notificationRow({
      recipient: "carol",
      sourceType: "activity",
      sourceRef: String(activity.event_key),
      eventType: "status_change",
      actor: "alice",
      occurredAt: "2026-08-01T00:01:00.000Z",
    });
    const first = setupFetch([
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([activity]),
      response(subscriptions),
      response([bob]),
      { status: 500, body: { detail: "notification write failed" } },
      response([]),
    ]);

    await expect(project()).resolves.toMatchObject({
      activity: { failed: true, cursor: null },
    });
    expect(
      first.calls.filter((call) => sql(call).includes("UPDATE reef_settings")),
    ).toHaveLength(0);

    const retry = setupFetch([
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([activity]),
      response(subscriptions),
      response([bob]),
      response([carol]),
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([]),
    ]);
    await expect(project()).resolves.toMatchObject({
      activity: { failed: false, fannedOut: 2 },
    });

    const firstBobInsert = first.calls
      .map(sql)
      .find((statement) => statement.includes("'bob'"));
    const retryBobInsert = retry.calls
      .map(sql)
      .find((statement) => statement.includes("'bob'"));
    expect(firstBobInsert).toContain(
      "ON CONFLICT (notification_key) DO UPDATE",
    );
    expect(retryBobInsert).toContain(
      buildNotificationKey({
        recipient: "bob",
        sourceType: "activity",
        sourceRef: String(activity.event_key),
      }),
    );
    expect(retry.calls.map(sql).join("\n")).toContain("'carol'");
  });
});
