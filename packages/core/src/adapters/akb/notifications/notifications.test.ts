import { describe, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
  akbCreateNotification,
  akbGetEffectiveSubscriptionState,
  akbListNotifications,
  akbListSubscriptions,
  akbMuteIssue,
  akbRemoveSubscription,
  akbUpdateNotificationState,
  akbUpsertSubscription,
  akbWatchIssue,
  buildNotificationKey,
  buildSubscriptionKey,
  describeError,
} from "../../../index";
import {
  makeAdapter,
  makeSqlQueryResponse,
  sqlRequestBody,
  setupFetch,
} from "../core/akb.testSupport";

const FIRST_ID = "018f47a4-8e3b-7f62-a3d2-9876543210ab";
const SECOND_ID = "018f47a4-8e3b-7f62-a3d2-9876543210ac";

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIRST_ID,
    notification_key: buildNotificationKey({
      recipient: "kim",
      sourceType: "issue_activity",
      sourceRef: "status:1",
    }),
    recipient: "kim",
    reef_id: "REEF-1",
    source_type: "issue_activity",
    source_ref: "status:1",
    event_type: "status_change",
    actor: "lee",
    occurred_at: "2026-07-28T00:00:00.000Z",
    state: "unread",
    read_at: null,
    archived_at: null,
    payload: '{"version":1}',
    meta: null,
    ...overrides,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIRST_ID,
    subscription_key: buildSubscriptionKey({
      reefId: "REEF-1",
      subscriber: "kim",
      source: "manual",
    }),
    reef_id: "REEF-1",
    subscriber: "kim",
    source: "manual",
    status: "active",
    subscribed_at: "2026-07-28T00:00:00.000Z",
    meta: null,
    ...overrides,
  };
}

describe("notification adapter", () => {
  it("creates one identity idempotently and rejects incompatible key reuse", async () => {
    const input = {
      recipient: "kim",
      reefId: "REEF-1",
      sourceType: "issue_activity",
      sourceRef: "status:1",
      eventType: "status_change",
      actor: "lee",
      occurredAt: "2026-07-28T00:00:00.000Z",
      payload: { version: 2 },
    };
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [notificationRow()],
          ["id", "notification_key"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [notificationRow({ recipient: "other" })],
          ["id", "notification_key"],
        ),
      },
    ]);
    const adapter = makeAdapter();

    await expect(
      akbCreateNotification(adapter, "reef-sample", input),
    ).resolves.toMatchObject({
      recipient: "kim",
      payload: { version: 1 },
    });
    await expect(
      akbCreateNotification(adapter, "reef-sample", input),
    ).rejects.toBeInstanceOf(ConflictError);

    const request = sqlRequestBody(calls[0]);
    expect(request.sql).toContain("ON CONFLICT (notification_key) DO UPDATE");
    expect(request.sql).toContain(
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread', NULL, NULL, $9::jsonb, NULL)",
    );
    expect(request.params).toEqual([
      buildNotificationKey({
        recipient: input.recipient,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
      }),
      input.recipient,
      input.reefId,
      input.sourceType,
      input.sourceRef,
      input.eventType,
      input.actor,
      input.occurredAt,
      JSON.stringify(input.payload),
    ]);
    expect(request.sql).not.toContain(input.recipient);
    expect(request.sql).not.toContain(input.reefId);
    expect(request.sql).not.toContain(input.sourceRef);
    expect(request.sql).not.toContain("jwt.example.token");
  });

  it("round-trips special scalar values and ordered JSON parameters", async () => {
    const input = {
      recipient: "kim'\\한글😀",
      reefId: "REEF-'1",
      sourceType: "issue_activity",
      sourceRef: "status:'1\\\\",
      eventType: "status_change",
      actor: "lee'\\한글😀",
      occurredAt: "2026-07-28T00:00:00.000Z",
      payload: {
        text: "it's \\\\ 한글😀",
        nested: { enabled: true, count: 2, empty: null },
      },
      meta: { source: "manual'\\", nested: { issue: "REEF-'1" } },
    };
    const notificationKey = buildNotificationKey({
      recipient: input.recipient,
      sourceType: input.sourceType,
      sourceRef: input.sourceRef,
    });
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            notificationRow({
              notification_key: notificationKey,
              recipient: input.recipient,
              reef_id: input.reefId,
              source_ref: input.sourceRef,
              actor: input.actor,
              payload: JSON.stringify(input.payload),
              meta: JSON.stringify(input.meta),
            }),
          ],
          ["id"],
        ),
      },
    ]);

    await expect(
      akbCreateNotification(makeAdapter(), "reef-sample", input),
    ).resolves.toMatchObject({
      notification_key: notificationKey,
      recipient: input.recipient,
      payload: input.payload,
      meta: input.meta,
    });

    const request = sqlRequestBody(calls[0]);
    expect(request.sql).toContain(
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unread', NULL, NULL, $9::jsonb, $10::jsonb)",
    );
    expect(request.params).toEqual([
      notificationKey,
      input.recipient,
      input.reefId,
      input.sourceType,
      input.sourceRef,
      input.eventType,
      input.actor,
      input.occurredAt,
      JSON.stringify(input.payload),
      JSON.stringify(input.meta),
    ]);
    for (const value of [
      notificationKey,
      input.recipient,
      input.reefId,
      input.sourceRef,
      input.actor,
    ]) {
      expect(request.sql).not.toContain(value);
    }
  });

  it("scopes, bounds, and stably sorts notification lists", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            notificationRow({
              id: FIRST_ID,
              occurred_at: "2026-07-28T00:00:00.000Z",
            }),
            notificationRow({
              id: SECOND_ID,
              notification_key: "notification:other",
              source_ref: "status:2",
              occurred_at: "2026-07-29T00:00:00.000Z",
            }),
          ],
          ["id"],
        ),
      },
    ]);

    const notifications = await akbListNotifications(
      makeAdapter(),
      "reef-sample",
      { recipient: "kim", state: "unread", limit: 2 },
    );

    expect(notifications.map((item) => item.id)).toEqual([SECOND_ID, FIRST_ID]);
    const request = sqlRequestBody(calls[0]);
    expect(request.sql).toContain("recipient = $1");
    expect(request.sql).toContain("state = $2");
    expect(request.sql).toContain(
      "ORDER BY occurred_at DESC, id DESC LIMIT $3",
    );
    expect(request.params).toEqual(["kim", "unread", 2]);
    expect(request.sql).not.toContain("kim");
    expect(request.sql).not.toContain("unread");
  });

  it("normalizes state timestamps and never mutates another recipient", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            notificationRow({
              state: "archived",
              read_at: "2026-07-29T00:00:00.000Z",
              archived_at: "2026-07-29T00:00:00.000Z",
            }),
          ],
          ["id"],
        ),
      },
      { body: makeSqlQueryResponse([], ["id"]) },
    ]);
    const adapter = makeAdapter();
    const notificationKey = notificationRow().notification_key;

    await expect(
      akbUpdateNotificationState(adapter, "reef-sample", {
        notificationKey,
        recipient: "kim",
        state: "archived",
        changedAt: "2026-07-29T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ state: "archived" });
    await expect(
      akbUpdateNotificationState(adapter, "reef-sample", {
        notificationKey,
        recipient: "other",
        state: "read",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const request = sqlRequestBody(calls[0]);
    expect(request.sql).toContain("read_at = COALESCE(read_at, $2)");
    expect(request.sql).toContain("archived_at = COALESCE(archived_at, $2)");
    expect(request.sql).toContain("recipient = $4");
    expect(request.params).toEqual([
      "archived",
      "2026-07-29T00:00:00.000Z",
      notificationKey,
      "kim",
    ]);
    expect(request.sql).not.toContain(notificationKey);
    expect(request.sql).not.toContain("kim");
  });

  it("rejects invalid input before any AKB request", async () => {
    const { calls } = setupFetch([]);
    await expect(
      akbListNotifications(makeAdapter(), "reef-sample", {
        recipient: "",
        limit: 101,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });

  it("rejects NUL and unserializable JSON before any AKB request", async () => {
    const { calls } = setupFetch([]);
    const adapter = makeAdapter();
    const baseInput = {
      reefId: "REEF-1",
      sourceType: "issue_activity",
      sourceRef: "status:1",
      eventType: "status_change",
      actor: "lee",
      occurredAt: "2026-07-28T00:00:00.000Z",
    };

    await expect(
      akbCreateNotification(adapter, "reef-sample", {
        ...baseInput,
        recipient: "bad\0recipient",
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      akbCreateNotification(adapter, "reef-sample", {
        ...baseInput,
        recipient: "kim",
        payload: { nested: { value: "bad\0value" } },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      akbCreateNotification(adapter, "reef-sample", {
        ...baseInput,
        recipient: "kim",
        payload: { nested: { value: 1n } },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      akbUpsertSubscription(adapter, "reef-sample", {
        reefId: "REEF-1",
        subscriber: "kim",
        source: "manual",
        meta: { nested: { value: "bad\0value" } },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      akbUpsertSubscription(adapter, "reef-sample", {
        reefId: "REEF-1",
        subscriber: "kim",
        source: "manual",
        meta: { nested: { value: 1n } },
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    expect(calls).toHaveLength(0);
  });

  it("keeps upstream bodies, SQL, and credentials out of the public error descriptor", async () => {
    setupFetch([
      {
        status: 500,
        body: {
          detail: "password=test-secret while SELECT * FROM reef_notifications",
        },
      },
    ]);

    const error = await akbListNotifications(makeAdapter(), "reef-sample", {
      recipient: "kim",
    }).catch((caught: unknown) => caught);
    const descriptor = describeError(error);
    const serialized = JSON.stringify(descriptor);

    expect(serialized).not.toContain("test-secret");
    expect(serialized).not.toContain("SELECT");
    expect(serialized).not.toContain("reef_notifications");
  });
});

describe("subscription adapter", () => {
  it("upserts source rows independently and removes only the requested source", async () => {
    const requester = subscriptionRow({
      source: "requester",
      subscription_key: buildSubscriptionKey({
        reefId: "REEF-1",
        subscriber: "kim",
        source: "requester",
      }),
    });
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([requester], ["id"]) },
      { body: makeSqlQueryResponse([{ id: FIRST_ID }], ["id"]) },
      { body: makeSqlQueryResponse([requester], ["id"]) },
    ]);
    const adapter = makeAdapter();

    await akbUpsertSubscription(adapter, "reef-sample", {
      reefId: "REEF-1",
      subscriber: "kim",
      source: "requester",
      status: "active",
      subscribedAt: "2026-07-28T00:00:00.000Z",
    });
    await expect(
      akbRemoveSubscription(adapter, "reef-sample", {
        reefId: "REEF-1",
        subscriber: "kim",
        source: "manual",
      }),
    ).resolves.toBe(true);
    await akbListSubscriptions(adapter, "reef-sample", {
      reefId: "REEF-1",
      subscriber: "kim",
    });

    const upsertRequest = sqlRequestBody(calls[0]);
    expect(upsertRequest.sql).toContain(
      "VALUES ($1, $2, $3, $4, $5, $6, NULL)",
    );
    expect(upsertRequest.params).toEqual([
      requester.subscription_key,
      "REEF-1",
      "kim",
      "requester",
      "active",
      "2026-07-28T00:00:00.000Z",
    ]);

    const deleteRequest = sqlRequestBody(calls[1]);
    expect(deleteRequest.sql).toContain(
      "WHERE reef_id = $1 AND subscriber = $2 AND source = $3",
    );
    expect(deleteRequest.params).toEqual(["REEF-1", "kim", "manual"]);
    expect(deleteRequest.sql).not.toContain("manual");
    expect(deleteRequest.sql).not.toContain("kim");

    const listRequest = sqlRequestBody(calls[2]);
    expect(listRequest.params).toEqual(["REEF-1", "kim"]);
  });

  it("makes manual mute authoritative and Watch restores manual active", async () => {
    const muted = subscriptionRow({ status: "muted" });
    const active = subscriptionRow({ status: "active" });
    const { calls } = setupFetch([
      { body: makeSqlQueryResponse([muted], ["id"]) },
      {
        body: makeSqlQueryResponse(
          [
            muted,
            subscriptionRow({
              id: SECOND_ID,
              source: "requester",
              status: "active",
              subscription_key: "subscription:requester",
            }),
          ],
          ["id"],
        ),
      },
      { body: makeSqlQueryResponse([active], ["id"]) },
      { body: makeSqlQueryResponse([active], ["id"]) },
      { body: makeSqlQueryResponse([active], ["id"]) },
    ]);
    const adapter = makeAdapter();

    await akbMuteIssue(adapter, "reef-sample", {
      reefId: "REEF-1",
      subscriber: "kim",
      subscribedAt: "2026-07-28T00:00:00.000Z",
    });
    await expect(
      akbGetEffectiveSubscriptionState(adapter, "reef-sample", {
        reefId: "REEF-1",
        subscriber: "kim",
      }),
    ).resolves.toBe("muted");
    await akbWatchIssue(adapter, "reef-sample", {
      reefId: "REEF-1",
      subscriber: "kim",
      subscribedAt: "2026-07-29T00:00:00.000Z",
    });
    await expect(
      akbGetEffectiveSubscriptionState(adapter, "reef-sample", {
        reefId: "REEF-1",
        subscriber: "kim",
      }),
    ).resolves.toBe("watching");

    const watchRequest = sqlRequestBody(calls[2]);
    expect(watchRequest.sql).toContain("status = EXCLUDED.status");
    expect(watchRequest.params).toEqual([
      active.subscription_key,
      "REEF-1",
      "kim",
      "manual",
      "active",
      "2026-07-29T00:00:00.000Z",
    ]);
  });
});
