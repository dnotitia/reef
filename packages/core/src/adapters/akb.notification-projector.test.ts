import { describe, expect, it } from "vitest";
import {
  SchemaValidationError,
  akbRunNotificationProjector,
  buildNotificationKey,
  buildSubscriptionKey,
} from "../index";
import {
  makeAdapter,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  setupFetch,
} from "./akb.testSupport";

const ID = "11111111-1111-4111-8111-111111111111";
const NEXT_ID = "22222222-2222-4222-8222-222222222222";
const enabledAt = "2026-07-31T00:00:00.000Z";
const state = {
  version: 1 as const,
  enabled_at: enabledAt,
  activity: { occurred_at: enabledAt, id: "" },
  comment: { occurred_at: enabledAt, id: "" },
};

const sql = (body: unknown): string => JSON.parse(String(body)).sql as string;

function activityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    reef_id: "REEF-430",
    event_type: "status_change",
    event_key: "status_change:todo->in_progress@2026-07-31T00:01:00.000Z",
    payload: { from: "todo", to: "in_progress" },
    meta: {
      actor: "alice",
      at: "2026-07-31T00:01:00.000Z",
      source: "ai-agent:user_request",
    },
    projector_sort_at: "2026-07-31T00:01:00.000Z",
    ...overrides,
  };
}

function subscriptionRow(
  subscriber: string,
  source: "manual" | "requester" | "assignee" | "commenter",
  status: "active" | "muted",
) {
  return {
    id: NEXT_ID,
    subscription_key: buildSubscriptionKey({
      reefId: "REEF-430",
      subscriber,
      source,
    }),
    reef_id: "REEF-430",
    subscriber,
    source,
    status,
    subscribed_at: enabledAt,
    meta: null,
  };
}

function notificationRow(recipient: string) {
  return {
    id: NEXT_ID,
    notification_key: buildNotificationKey({
      recipient,
      sourceType: "activity",
      sourceRef: "status_change:todo->in_progress@2026-07-31T00:01:00.000Z",
    }),
    recipient,
    reef_id: "REEF-430",
    source_type: "activity",
    source_ref: "status_change:todo->in_progress@2026-07-31T00:01:00.000Z",
    event_type: "status_change",
    actor: "alice",
    occurred_at: "2026-07-31T00:01:00.000Z",
    state: "unread",
    read_at: null,
    archived_at: null,
    payload: { from: "todo", to: "in_progress" },
    meta: { provenance: { source: "activity" } },
  };
}

function commentNotificationRow(recipient: string) {
  return {
    ...notificationRow(recipient),
    notification_key: buildNotificationKey({
      recipient,
      sourceType: "comment",
      sourceRef: ID,
    }),
    source_type: "comment",
    source_ref: ID,
    event_type: "comment_created",
    payload: { comment_id: ID },
  };
}

describe("notification projector", () => {
  it("durably activates before it reads either source", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([], ["value"]) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    const result = await akbRunNotificationProjector(makeAdapter(), {
      vault: "reef-sample",
      now: () => new Date(enabledAt),
    });

    expect(result).toMatchObject({
      activated: true,
      activity: { scanned: 0, checkpoint: { occurred_at: enabledAt } },
      comment: { scanned: 0, checkpoint: { occurred_at: enabledAt } },
    });
    expect(calls).toHaveLength(2);
    expect(sql(calls[1]?.init?.body)).toContain("notification_projector_v1");
    expect(sql(calls[1]?.init?.body)).toContain(enabledAt);
  });

  it("uses raw keysets, snapshots effective recipients once, and excludes mute and self", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([{ value: state }], ["value"]) },
      { body: makeSqlQueryResponse([activityRow()], ["id"]) },
      {
        body: makeSqlQueryResponse(
          [
            subscriptionRow("alice", "assignee", "active"),
            subscriptionRow("bob", "requester", "active"),
            subscriptionRow("carol", "requester", "active"),
            subscriptionRow("carol", "manual", "muted"),
          ],
          ["id"],
        ),
      },
      { body: makeSqlQueryResponse([notificationRow("bob")], ["id"]) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeSqlQueryResponse([], ["id"]) },
    ]);

    const result = await akbRunNotificationProjector(makeAdapter(), {
      vault: "reef-sample",
    });

    expect(result).toMatchObject({
      activated: false,
      activity: { scanned: 1, malformed: 0, delivered: 1, skipped: 0 },
      comment: { scanned: 0 },
    });
    const activitySql = sql(calls[1]?.init?.body);
    expect(activitySql).toContain("meta->>'at' > '2026-07-31T00:00:00.000Z'");
    expect(activitySql).toContain("AND id > ''");
    expect(activitySql).toContain("ORDER BY meta->>'at' ASC, id ASC LIMIT 50");
    const notificationSql = sql(calls[3]?.init?.body);
    expect(notificationSql).toContain("recipient, reef_id, source_type");
    expect(notificationSql).toContain("'bob'");
    expect(notificationSql).not.toContain("'carol'");
  });

  it("keeps a failed event before its checkpoint so replay fills only the missing recipient", async () => {
    const recipients = [
      subscriptionRow("bob", "requester", "active"),
      subscriptionRow("carol", "commenter", "active"),
    ];
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([{ value: state }], ["value"]) },
      { body: makeSqlQueryResponse([activityRow()], ["id"]) },
      { body: makeSqlQueryResponse(recipients, ["id"]) },
      { body: makeSqlQueryResponse([notificationRow("bob")], ["id"]) },
      { status: 500, body: { detail: "credential-free upstream failure" } },
      { body: makeSqlQueryResponse([{ value: state }], ["value"]) },
      { body: makeSqlQueryResponse([activityRow()], ["id"]) },
      { body: makeSqlQueryResponse(recipients, ["id"]) },
      { body: makeSqlQueryResponse([notificationRow("bob")], ["id"]) },
      { body: makeSqlQueryResponse([notificationRow("carol")], ["id"]) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeSqlQueryResponse([], ["id"]) },
    ]);
    const adapter = makeAdapter();

    await expect(
      akbRunNotificationProjector(adapter, { vault: "reef-sample" }),
    ).rejects.toBeDefined();
    await expect(
      akbRunNotificationProjector(adapter, { vault: "reef-sample" }),
    ).resolves.toMatchObject({ activity: { delivered: 2 } });

    expect(
      calls.filter((call) => sql(call.init?.body).includes("reef_settings")),
    ).toHaveLength(3);
  });

  it("advances past malformed source rows and never copies a comment body", async () => {
    const malformed = activityRow({
      meta: { actor: "alice", at: "not-a-time" },
    });
    const comment = {
      id: ID,
      reef_id: "REEF-430",
      body: "COMMENT_BODY_CANARY_DO_NOT_COPY",
      meta: { author: "alice", created_at: "2026-07-31T00:02:00.000Z" },
      projector_sort_at: "2026-07-31T00:02:00.000Z",
    };
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([{ value: state }], ["value"]) },
      { body: makeSqlQueryResponse([malformed], ["id"]) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      { body: makeSqlQueryResponse([comment], ["id"]) },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("bob", "commenter", "active")],
          ["id"],
        ),
      },
      { body: makeSqlQueryResponse([commentNotificationRow("bob")], ["id"]) },
      { body: makeSqlMutationResponse("INSERT 0 1") },
    ]);

    await expect(
      akbRunNotificationProjector(makeAdapter(), { vault: "reef-sample" }),
    ).resolves.toMatchObject({
      activity: { scanned: 1, malformed: 1 },
      comment: { scanned: 1, delivered: 1 },
    });
    const serializedNotification = sql(calls[5]?.init?.body);
    expect(serializedNotification).not.toContain(
      "COMMENT_BODY_CANARY_DO_NOT_COPY",
    );
    expect(serializedNotification).toContain('"comment_id"');
  });

  it("fails closed on invalid durable state without creating a checkpoint", async () => {
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([{ value: { version: 0 } }], ["value"]) },
    ]);

    await expect(
      akbRunNotificationProjector(makeAdapter(), { vault: "reef-sample" }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(1);
  });
});
