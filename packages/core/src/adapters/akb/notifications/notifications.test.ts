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
  setupFetch,
} from "../core/testSupport";

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

    const sql = JSON.parse(String(calls[0]?.init?.body)).sql as string;
    expect(sql).toContain("ON CONFLICT (notification_key) DO UPDATE");
    expect(sql).not.toContain("jwt.example.token");
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
    const sql = JSON.parse(String(calls[0]?.init?.body)).sql as string;
    expect(sql).toContain("recipient = 'kim'");
    expect(sql).toContain("state = 'unread'");
    expect(sql).toContain("ORDER BY occurred_at DESC, id DESC LIMIT 2");
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

    const sql = JSON.parse(String(calls[0]?.init?.body)).sql as string;
    expect(sql).toContain("read_at = COALESCE(read_at");
    expect(sql).toContain("archived_at = COALESCE(archived_at");
    expect(sql).toContain("recipient = 'kim'");
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

  it("keeps upstream bodies, SQL, and credentials out of the public error descriptor", async () => {
    setupFetch([
      {
        status: 500,
        body: {
          detail:
            "password=secret-value while SELECT * FROM reef_notifications",
        },
      },
    ]);

    const error = await akbListNotifications(makeAdapter(), "reef-sample", {
      recipient: "kim",
    }).catch((caught: unknown) => caught);
    const descriptor = describeError(error);
    const serialized = JSON.stringify(descriptor);

    expect(serialized).not.toContain("secret-value");
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

    const deleteSql = JSON.parse(String(calls[1]?.init?.body)).sql as string;
    expect(deleteSql).toContain("source = 'manual'");
    expect(deleteSql).toContain("subscriber = 'kim'");
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

    const watchSql = JSON.parse(String(calls[2]?.init?.body)).sql as string;
    expect(watchSql).toContain("status = EXCLUDED.status");
  });
});
