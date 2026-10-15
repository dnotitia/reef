import { describe, expect, it } from "vitest";
import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
  akbCreateNotification,
  akbGetEffectiveSubscriptionState,
  akbListPersonalNotifications,
  akbListSubscriptions,
  akbMarkAllPersonalNotificationsRead,
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
  it("snapshots every unread identity across workspaces before applying state writes", async () => {
    const targets = Array.from({ length: 101 }, (_, index) => ({
      workspace: index === 100 ? "reef-zeta" : "reef-alpha",
      notification_key:
        index === 100 ? "duplicate-key" : `notification-${index}`,
    }));
    targets[0] = { workspace: "reef-alpha", notification_key: "duplicate-key" };
    const readAt = "2026-10-15T14:00:00.000Z";
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          targets.map(({ workspace, notification_key }) => ({
            workspace,
            notification_key,
          })),
          ["workspace", "notification_key"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          targets
            .filter(({ workspace }) => workspace === "reef-alpha")
            .map(({ notification_key }) => ({
              notification_key,
              state: "read",
              read_at: readAt,
            })),
          ["notification_key", "state", "read_at"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            {
              notification_key: "duplicate-key",
              state: "read",
              read_at: readAt,
            },
          ],
          ["notification_key", "state", "read_at"],
        ),
      },
    ]);

    const result = await akbMarkAllPersonalNotificationsRead(makeAdapter(), {
      recipient: "kim",
      workspaces: ["reef-zeta", "reef-alpha"],
    });

    expect(result.targets).toHaveLength(101);
    expect(result.completed).toHaveLength(101);
    expect(result.unresolved).toEqual([]);
    expect(result.completed.map(({ workspace }) => workspace)).toContain(
      "reef-zeta",
    );
    const updateSql = sqlRequestBody(calls[1]).sql;
    const requests = calls.map((call) => sqlRequestBody(call));
    expect(requests[0]?.sql).not.toContain("occurred_at");
    expect(requests[0]?.sql).not.toContain("ROW_NUMBER");
    expect(requests[0]?.sql).not.toContain("LIMIT");
    expect(requests[0]?.sql).toContain("state = 'unread'");
    expect(requests[1]?.sql).toContain("state = 'unread'");
    expect(requests[1]?.sql).not.toContain("archived_at = NULL");
    expect(requests[1]?.params).toContain("kim");
    expect(updateSql).toContain("jsonb_array_elements_text($1::jsonb)");
    expect(updateSql).not.toContain("::jsonb::jsonb");
  });

  it("retries only the supplied unresolved identities and keeps cross-workspace keys distinct", async () => {
    const targets = [
      { workspace: "reef-alpha", notification_key: "same-key" },
      { workspace: "reef-zeta", notification_key: "same-key" },
    ];
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            {
              notification_key: "same-key",
              state: "read",
              read_at: "2026-10-15T14:00:00.000Z",
            },
          ],
          ["notification_key", "state", "read_at"],
        ),
      },
      {
        status: 403,
        body: { error: "permission_denied" },
      },
    ]);

    const result = await akbMarkAllPersonalNotificationsRead(makeAdapter(), {
      recipient: "kim",
      workspaces: ["reef-alpha", "reef-zeta"],
      targets,
    });

    expect(result.targets).toEqual(targets);
    expect(result.completed).toEqual([
      {
        workspace: "reef-alpha",
        notification_key: "same-key",
        state: "read",
        read_at: "2026-10-15T14:00:00.000Z",
      },
    ]);
    expect(result.unresolved).toEqual([targets[1]]);
    expect(calls).toHaveLength(2);
    expect(sqlRequestBody(calls[0]).sql).toContain("UPDATE reef_notifications");
    expect(sqlRequestBody(calls[1]).params).toContain("kim");
  });

  it("returns the row produced by the conditional update CTE", async () => {
    const target = {
      workspace: "reef-alpha",
      notification_key: "notification-1",
    };
    const readAt = "2026-10-15T14:00:00.000Z";
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse([target], ["workspace", "notification_key"]),
      },
      {
        body: makeSqlQueryResponse(
          [
            {
              notification_key: target.notification_key,
              state: "read",
              read_at: readAt,
            },
          ],
          ["notification_key", "state", "read_at"],
        ),
      },
    ]);

    const result = await akbMarkAllPersonalNotificationsRead(makeAdapter(), {
      recipient: "kim",
      workspaces: [target.workspace],
    });

    expect(sqlRequestBody(calls[1]).sql).toContain("updated.state");
    expect(sqlRequestBody(calls[1]).sql).toContain("updated.read_at");
    expect(result.completed).toEqual([
      { ...target, state: "read", read_at: readAt },
    ]);
    expect(result.unresolved).toEqual([]);
  });

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

  it("ranks cross-workspace notifications by instant before applying each state cap", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            notificationRow({
              id: FIRST_ID,
              workspace: "reef-alpha",
              occurred_at: "2026-01-01T01:00:00.000+02:00",
            }),
            notificationRow({
              id: SECOND_ID,
              workspace: "reef-zeta",
              occurred_at: "2025-12-31T23:30:00.000Z",
            }),
            notificationRow({
              id: "018f47a4-8e3b-7f62-a3d2-9876543210ad",
              workspace: "reef-alpha",
              state: "read",
              occurred_at: "2025-12-31T23:30:00.000Z",
            }),
          ],
          ["id"],
        ),
      },
    ]);

    const notifications = await akbListPersonalNotifications(makeAdapter(), {
      recipient: "kim",
      workspaces: ["reef-zeta", "reef-alpha"],
    });

    expect(
      notifications.map((item) => [item.workspace, item.id, item.state]),
    ).toEqual([
      ["reef-alpha", "018f47a4-8e3b-7f62-a3d2-9876543210ad", "read"],
      ["reef-zeta", SECOND_ID, "unread"],
      ["reef-alpha", FIRST_ID, "unread"],
    ]);
    expect(notifications[0]?.notification_key).toBe(
      notifications[2]?.notification_key,
    );
    const request = sqlRequestBody(calls[0]);
    expect(request.sql).not.toContain("notification_rows.*");
    expect(request.sql.match(/"notification_rows"\."payload"/g)).toHaveLength(
      2,
    );
    expect(request.sql).toContain("notification_rows.recipient = $1");
    expect(request.sql).toContain("state IN ('unread', 'read')");
    expect(request.sql).toContain("archived_at IS NULL");
    expect(request.sql).toContain("state_rank <= $4");
    expect(request.sql).toContain(
      "ROW_NUMBER() OVER (PARTITION BY state ORDER BY occurred_at::timestamptz DESC, workspace ASC, id DESC)",
    );
    expect(request.sql).toContain(
      "WHERE state_rank <= $4 ORDER BY occurred_at::timestamptz DESC, workspace ASC, id DESC",
    );
    expect(request.params).toEqual(["kim", "reef-alpha", "reef-zeta", 100]);
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      vaults?: string[];
    };
    expect(body.vaults).toEqual(["reef-alpha", "reef-zeta"]);
    expect(request.sql).not.toContain("kim");
    expect(request.sql).not.toContain("reef-alpha");
    expect(request.sql).not.toContain("reef-zeta");
  });

  it("loads issue titles and the exact original status event from each source workspace", async () => {
    const activityRow = (overrides: Record<string, unknown>) => ({
      id: FIRST_ID,
      reef_id: "REEF-1",
      event_type: "status_change",
      event_key: "status:1",
      payload: JSON.stringify({ from: "todo", to: "in_progress" }),
      meta: JSON.stringify({
        actor: "lee",
        at: "2026-07-28T00:00:00.000Z",
        source: "user:board",
      }),
      ...overrides,
    });
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            notificationRow({
              source_type: "activity",
              workspace: "reef-alpha",
            }),
            notificationRow({
              id: SECOND_ID,
              source_type: "activity",
              workspace: "reef-zeta",
            }),
          ],
          ["id", "workspace"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [{ reef_id: "REEF-1", title: "Alpha source title" }],
          ["reef_id", "title"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            activityRow({
              payload: JSON.stringify({ from: "todo", to: "in_progress" }),
            }),
          ],
          ["id", "reef_id", "event_type", "event_key", "payload", "meta"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [{ reef_id: "REEF-1", title: "Zeta source title" }],
          ["reef_id", "title"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            activityRow({
              payload: JSON.stringify({ from: "backlog", to: "done" }),
            }),
          ],
          ["id", "reef_id", "event_type", "event_key", "payload", "meta"],
        ),
      },
    ]);

    const notifications = await akbListPersonalNotifications(makeAdapter(), {
      recipient: "kim",
      workspaces: ["reef-zeta", "reef-alpha"],
    });
    const alpha = notifications.find(
      ({ workspace }) => workspace === "reef-alpha",
    );
    const zeta = notifications.find(
      ({ workspace }) => workspace === "reef-zeta",
    );

    expect(alpha).toMatchObject({
      issue_context: { availability: "available", title: "Alpha source title" },
      status_change_context: {
        availability: "available",
        from: "todo",
        to: "in_progress",
      },
    });
    expect(zeta).toMatchObject({
      issue_context: { availability: "available", title: "Zeta source title" },
      status_change_context: {
        availability: "available",
        from: "backlog",
        to: "done",
      },
    });
    const requests = calls.map((call) => sqlRequestBody(call));
    expect(requests[1]?.sql).toContain(
      "SELECT reef_id, title FROM reef_issues",
    );
    const sourceReads = requests.filter((request) =>
      request.sql.includes("FROM reef_activity"),
    );
    expect(sourceReads).toHaveLength(2);
    expect(sourceReads[0]?.sql).toContain("event_key");
    expect(sourceReads[0]?.sql).not.toContain("status =");
    expect(sourceReads[0]?.params).toEqual(["REEF-1", "status:1"]);
    expect(sourceReads[1]?.params).toEqual(["REEF-1", "status:1"]);
    const sourceVaults = calls
      .filter((call) => sqlRequestBody(call).sql.includes("FROM reef_activity"))
      .map((call) => new URL(call.url).pathname.split("/").at(-2));
    expect(sourceVaults).toEqual(["reef-alpha", "reef-zeta"]);
  });

  it("marks missing or invalid source issue history unavailable without failing the list", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            notificationRow({
              source_type: "activity",
              workspace: "reef-alpha",
            }),
          ],
          ["id", "workspace"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [{ reef_id: "REEF-1", title: "  " }],
          ["reef_id", "title"],
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            {
              id: FIRST_ID,
              reef_id: "REEF-1",
              event_type: "status_change",
              event_key: "status:1",
              payload: JSON.stringify({ from: "todo", to: "not-a-status" }),
              meta: JSON.stringify({
                actor: "lee",
                at: "2026-07-28T00:00:00.000Z",
              }),
            },
          ],
          ["id", "reef_id", "event_type", "event_key", "payload", "meta"],
        ),
      },
    ]);

    const notifications = await akbListPersonalNotifications(makeAdapter(), {
      recipient: "kim",
      workspaces: ["reef-alpha"],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      issue_context: { availability: "unavailable", title: null },
      status_change_context: {
        availability: "unavailable",
        from: null,
        to: null,
      },
    });
    expect(calls).toHaveLength(3);
  });

  it("keeps the list and marks source details unavailable when source reads are denied", async () => {
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            notificationRow({
              source_type: "activity",
              workspace: "reef-alpha",
            }),
          ],
          ["id", "workspace"],
        ),
      },
      {
        status: 403,
        body: { error: "permission_denied", detail: "issue read denied" },
      },
      {
        status: 403,
        body: { error: "permission_denied", detail: "activity read denied" },
      },
    ]);

    const notifications = await akbListPersonalNotifications(makeAdapter(), {
      recipient: "kim",
      workspaces: ["reef-alpha"],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      issue_context: { availability: "unavailable", title: null },
      status_change_context: {
        availability: "unavailable",
        from: null,
        to: null,
      },
    });
    expect(calls).toHaveLength(3);
  });

  it("returns an empty list without querying when no ready workspaces exist", async () => {
    const { calls } = setupFetch([]);

    await expect(
      akbListPersonalNotifications(makeAdapter(), {
        recipient: "kim",
        workspaces: [],
      }),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
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
      akbListPersonalNotifications(makeAdapter(), {
        recipient: "",
        workspaces: ["reef-sample"],
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

    const error = await akbListPersonalNotifications(makeAdapter(), {
      recipient: "kim",
      workspaces: ["reef-sample"],
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
