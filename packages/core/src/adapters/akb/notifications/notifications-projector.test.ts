import { describe, expect, it, vi } from "vitest";
import { akbProjectNotifications, buildNotificationKey } from "../../../index";
import {
  makeAdapter,
  makeSqlQueryResponse,
  setupFetch,
} from "../core/akb.testSupport";

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
    payload: JSON.stringify({ from: "todo", to: "in_progress" }),
    meta: JSON.stringify({
      actor: "alice",
      at: "2026-08-01T00:01:00.000Z",
    }),
    ...overrides,
  };
}

function issueBodyMentionActivityRow(
  added: unknown,
  overrides: Record<string, unknown> = {},
) {
  return activityRow({
    event_type: "issue_body_mentions_change",
    event_key: "issue_body_mentions_change:document-commit-1",
    payload: JSON.stringify({
      recipients: ["bob", "carol"],
      added,
      removed: [],
      document_commit: "document-commit-1",
    }),
    ...overrides,
  });
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
  state?: "unread" | "read" | "archived";
}) {
  const state = input.state ?? "unread";
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
    state,
    read_at: state === "unread" ? null : "2026-08-01T00:04:00.000Z",
    archived_at: state === "archived" ? "2026-08-01T00:04:00.000Z" : null,
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

function sql(call: { init?: RequestInit } = {}): string {
  return JSON.parse(String(call.init?.body)).sql as string;
}

function project() {
  return akbProjectNotifications({
    adapter: makeAdapter(),
    vault: "reef-sample",
    now: () => new Date(ACTIVATED_AT),
  });
}

function setupMentionProjectionFetch(comment: Record<string, unknown>) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let commentReads = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const request = JSON.parse(String(init?.body)) as { sql: string };
    const statement = request.sql;
    let items: Record<string, unknown>[];

    if (
      statement.includes("WITH updated AS") &&
      statement.includes("reef_settings")
    ) {
      items = [{ value: JSON.stringify(checkpoint()) }];
    } else if (
      statement.includes("SELECT value FROM") &&
      statement.includes("reef_settings")
    ) {
      items = [{ value: JSON.stringify(checkpoint()) }];
    } else if (statement.includes("reef_activity")) {
      items = [];
    } else if (statement.includes("reef_comments")) {
      items = commentReads++ === 0 ? [comment] : [];
    } else if (statement.includes("reef_subscriptions")) {
      items = [
        subscriptionRow("carol", "commenter", "active"),
        subscriptionRow("carol", "manual", "muted"),
        subscriptionRow("dana", "commenter", "active"),
        subscriptionRow("alice", "commenter", "active"),
      ];
    } else if (
      statement.includes("INSERT INTO") &&
      statement.includes("reef_notifications")
    ) {
      const recipient = statement.match(/VALUES \('[^']*', '([^']*)'/)?.[1];
      if (!recipient) throw new Error(`recipient missing from ${statement}`);
      items = [
        notificationRow({
          recipient,
          sourceType: "comment",
          sourceRef: String(comment.id),
          eventType: "comment_created",
          actor: "alice",
          occurredAt: "2026-06-15T00:02:00.000Z",
        }),
      ];
    } else {
      throw new Error(`unexpected SQL: ${statement}`);
    }

    return new Response(
      JSON.stringify(makeSqlQueryResponse(items, ["id", "value"])),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function setupActivityMentionProjectionFetch(options: {
  activity: Record<string, unknown>[];
  subscriptions?: Record<string, unknown>[];
  notifications?: Record<string, Record<string, unknown>>;
  failRecipients?: string[];
}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let activityReads = 0;
  const activity = options.activity[0];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const statement = JSON.parse(String(init?.body)).sql as string;
    let items: Record<string, unknown>[];

    if (statement.includes("reef_settings")) {
      items = [{ value: JSON.stringify(checkpoint()) }];
    } else if (statement.includes("reef_activity")) {
      items = activityReads++ === 0 ? options.activity : [];
    } else if (statement.includes("reef_subscriptions")) {
      items = options.subscriptions ?? [];
    } else if (
      statement.includes("INSERT INTO") &&
      statement.includes("reef_notifications")
    ) {
      const recipient = statement.match(/VALUES \('[^']*', '([^']*)'/)?.[1];
      if (!recipient) throw new Error(`recipient missing from ${statement}`);
      if (options.failRecipients?.includes(recipient)) {
        throw new Error(`notification write failed for ${recipient}`);
      }
      const eventKey = String(activity?.event_key ?? "mention-event");
      const eventType = String(
        activity?.event_type ?? "issue_body_mentions_change",
      );
      const actor = String(
        JSON.parse(String(activity?.meta ?? "{}"))?.actor ?? "alice",
      );
      const occurredAt = String(
        JSON.parse(String(activity?.meta ?? "{}"))?.at ??
          "2026-08-01T00:01:00.000Z",
      );
      items = [
        options.notifications?.[recipient] ??
          notificationRow({
            recipient,
            sourceType: "activity",
            sourceRef: eventKey,
            eventType,
            actor,
            occurredAt,
          }),
      ];
    } else if (statement.includes("reef_comments")) {
      items = [];
    } else {
      throw new Error(`unexpected SQL: ${statement}`);
    }

    return new Response(
      JSON.stringify(makeSqlQueryResponse(items, ["id", "value"])),
      { headers: { "content-type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
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
      "(meta->>'at') > '2026-08-01T00:00:00.000Z'",
    );
    expect(sql(calls[3] ?? {})).toContain(
      "(COALESCE(meta->>'edited_at', meta->>'created_at')) > '2026-08-01T00:00:00.000Z'",
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

  it("fans out persisted comment mentions without subscriptions and filters mute, self, and duplicates", async () => {
    const comment = commentRow({
      id: "comment-mention",
      meta: JSON.stringify({
        author: "alice",
        created_at: "2026-06-15T00:02:00.000Z",
        mention_recipients: ["bob", "carol", "alice", "bob"],
      }),
    });
    const { calls } = setupMentionProjectionFetch(comment);

    await expect(project()).resolves.toMatchObject({
      comment: { scanned: 1, fannedOut: 2, failed: false },
    });

    const notificationSql = calls
      .map(sql)
      .filter((statement) =>
        statement.includes("INSERT INTO reef_notifications"),
      );
    expect(notificationSql).toHaveLength(2);
    expect(
      notificationSql.map(
        (statement) => statement.match(/VALUES \('[^']*', '([^']*)'/)?.[1],
      ),
    ).toEqual(["bob", "dana"]);
  });

  it("uses the persisted edit time to replay a comment source for newly added recipients", async () => {
    const createdComment = commentRow({
      meta: JSON.stringify({
        author: "alice",
        created_at: "2026-08-01T00:02:00.000Z",
        edited_at: null,
        mention_recipients: ["bob"],
      }),
    });
    const first = setupFetch([
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([]),
      response([createdComment]),
      response([]),
      response([
        notificationRow({
          recipient: "bob",
          sourceType: "comment",
          sourceRef: COMMENT_ID,
          eventType: "comment_created",
          actor: "alice",
          occurredAt: "2026-08-01T00:02:00.000Z",
        }),
      ]),
      response([{ value: JSON.stringify(checkpoint()) }]),
    ]);

    await expect(project()).resolves.toMatchObject({
      comment: { scanned: 1, fannedOut: 1, failed: false },
    });

    const editedComment = commentRow({
      meta: JSON.stringify({
        author: "alice",
        created_at: "2026-08-01T00:02:00.000Z",
        edited_at: "2026-08-01T00:03:00.000Z",
        mention_recipients: ["bob", "carol"],
      }),
    });
    const second = setupFetch([
      response([
        {
          value: JSON.stringify(
            checkpoint({
              comment_cursor: {
                occurred_at: "2026-08-01T00:02:00.000Z",
                id: COMMENT_ID,
              },
            }),
          ),
        },
      ]),
      response([]),
      response([editedComment]),
      response([]),
      response([
        notificationRow({
          recipient: "bob",
          sourceType: "comment",
          sourceRef: COMMENT_ID,
          eventType: "comment_created",
          actor: "alice",
          occurredAt: "2026-08-01T00:03:00.000Z",
        }),
      ]),
      response([
        notificationRow({
          recipient: "carol",
          sourceType: "comment",
          sourceRef: COMMENT_ID,
          eventType: "comment_created",
          actor: "alice",
          occurredAt: "2026-08-01T00:03:00.000Z",
        }),
      ]),
      response([{ value: JSON.stringify(checkpoint()) }]),
    ]);

    await expect(project()).resolves.toMatchObject({
      comment: { scanned: 1, fannedOut: 2, failed: false },
    });

    const secondNotificationSql = second.calls
      .map(sql)
      .filter((statement) =>
        statement.includes("INSERT INTO reef_notifications"),
      );
    expect(secondNotificationSql).toHaveLength(2);
    expect(secondNotificationSql.join("\n")).toContain(
      buildNotificationKey({
        recipient: "bob",
        sourceType: "comment",
        sourceRef: COMMENT_ID,
      }),
    );
    expect(secondNotificationSql.join("\n")).toContain(
      buildNotificationKey({
        recipient: "carol",
        sourceType: "comment",
        sourceRef: COMMENT_ID,
      }),
    );
    expect(sql(first.calls.at(-1) ?? {})).toContain(
      `"comment_cursor":{"id":"${COMMENT_ID}","occurred_at":"2026-08-01T00:02:00.000Z"`,
    );
    expect(sql(second.calls.at(-1) ?? {})).toContain(
      `"comment_cursor":{"id":"${COMMENT_ID}","occurred_at":"2026-08-01T00:03:00.000Z"`,
    );
  });

  it("treats a malformed persisted mention projection as an empty list", async () => {
    const comment = commentRow({
      meta: JSON.stringify({
        author: "alice",
        created_at: "2026-08-01T00:02:00.000Z",
        mention_recipients: { unresolved: true },
      }),
    });
    const { calls } = setupFetch([
      response([{ value: JSON.stringify(checkpoint()) }]),
      response([]),
      response([comment]),
      response([]),
      response([{ value: JSON.stringify(checkpoint()) }]),
    ]);

    await expect(project()).resolves.toMatchObject({
      comment: {
        scanned: 1,
        fannedOut: 0,
        skippedNoRecipients: 1,
        failed: false,
      },
    });
    expect(
      calls.some((call) =>
        sql(call).includes("INSERT INTO reef_notifications"),
      ),
    ).toBe(false);
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

  it("fans out only payload.added recipients, without requiring subscriptions", async () => {
    const activity = issueBodyMentionActivityRow([
      "bob",
      "carol",
      "alice",
      "erin",
    ]);
    const { calls } = setupActivityMentionProjectionFetch({
      activity: [activity],
      subscriptions: [
        subscriptionRow("bob", "requester"),
        subscriptionRow("carol", "commenter"),
        subscriptionRow("carol", "manual", "muted"),
        subscriptionRow("dana", "requester"),
      ],
    });

    await expect(project()).resolves.toMatchObject({
      activity: { scanned: 1, fannedOut: 2, failed: false },
    });

    const notificationSql = calls
      .map(sql)
      .filter((statement) =>
        statement.includes("INSERT INTO reef_notifications"),
      );
    expect(notificationSql).toHaveLength(2);
    expect(
      notificationSql.map(
        (statement) => statement.match(/VALUES \('[^']*', '([^']*)'/)?.[1],
      ),
    ).toEqual(["bob", "erin"]);
    expect(notificationSql.join("\n")).toContain(
      "'issue_body_mentions_change'",
    );
    expect(notificationSql.join("\n")).not.toContain("'dana'");
    expect(notificationSql.join("\n")).not.toContain("'carol'");
    expect(
      calls
        .map(sql)
        .filter((statement) => statement.includes("reef_activity"))[0],
    ).toContain("payload");
  });

  it("fails closed for empty, removal-only, and malformed added payloads", async () => {
    const empty = setupActivityMentionProjectionFetch({
      activity: [issueBodyMentionActivityRow([])],
    });
    await expect(project()).resolves.toMatchObject({
      activity: {
        scanned: 1,
        fannedOut: 0,
        skippedNoRecipients: 1,
        skippedMalformed: 0,
      },
    });
    expect(empty.calls.map(sql).join("\n")).not.toContain(
      "INSERT INTO reef_notifications",
    );

    const removalOnly = setupActivityMentionProjectionFetch({
      activity: [
        issueBodyMentionActivityRow([], {
          event_key: "issue_body_mentions_change:document-commit-remove",
          payload: JSON.stringify({
            recipients: [],
            added: [],
            removed: ["bob"],
            document_commit: "document-commit-remove",
          }),
        }),
      ],
    });
    await expect(project()).resolves.toMatchObject({
      activity: { scanned: 1, fannedOut: 0, skippedNoRecipients: 1 },
    });
    expect(removalOnly.calls.map(sql).join("\n")).not.toContain(
      "INSERT INTO reef_notifications",
    );

    const malformed = setupActivityMentionProjectionFetch({
      activity: [
        issueBodyMentionActivityRow(
          { unresolved: true },
          {
            event_key: "issue_body_mentions_change:document-commit-malformed",
          },
        ),
      ],
    });
    await expect(project()).resolves.toMatchObject({
      activity: { scanned: 1, fannedOut: 0, skippedMalformed: 1 },
    });
    expect(malformed.calls.map(sql).join("\n")).not.toContain(
      "INSERT INTO reef_notifications",
    );
  });

  it("uses a new source identity when a recipient is removed and later re-added", async () => {
    const firstActivity = issueBodyMentionActivityRow(["bob"]);
    const first = setupActivityMentionProjectionFetch({
      activity: [firstActivity],
    });
    await expect(project()).resolves.toMatchObject({
      activity: { fannedOut: 1, failed: false },
    });

    const secondActivity = issueBodyMentionActivityRow(["bob"], {
      event_key: "issue_body_mentions_change:document-commit-2",
      payload: JSON.stringify({
        recipients: ["bob"],
        added: ["bob"],
        removed: [],
        document_commit: "document-commit-2",
      }),
      meta: JSON.stringify({
        actor: "alice",
        at: "2026-08-01T00:03:00.000Z",
      }),
    });
    const second = setupActivityMentionProjectionFetch({
      activity: [secondActivity],
    });
    await expect(project()).resolves.toMatchObject({
      activity: { fannedOut: 1, failed: false },
    });

    const firstInsert = first.calls
      .map(sql)
      .find((statement) =>
        statement.includes("INSERT INTO reef_notifications"),
      );
    const secondInsert = second.calls
      .map(sql)
      .find((statement) =>
        statement.includes("INSERT INTO reef_notifications"),
      );
    expect(firstInsert).toContain("document-commit-1");
    expect(secondInsert).toContain("document-commit-2");
    expect(secondInsert).not.toContain("document-commit-1");
  });

  it("replays an identical event idempotently while preserving read and archived state", async () => {
    const activity = issueBodyMentionActivityRow(["bob"]);
    const existing = notificationRow({
      recipient: "bob",
      sourceType: "activity",
      sourceRef: String(activity.event_key),
      eventType: "issue_body_mentions_change",
      actor: "alice",
      occurredAt: "2026-08-01T00:01:00.000Z",
      state: "archived",
    });
    const first = setupActivityMentionProjectionFetch({
      activity: [activity],
      notifications: { bob: existing },
    });
    await expect(project()).resolves.toMatchObject({
      activity: { fannedOut: 1, failed: false },
    });
    const retry = setupActivityMentionProjectionFetch({
      activity: [activity],
      notifications: { bob: existing },
    });
    await expect(project()).resolves.toMatchObject({
      activity: { fannedOut: 1, failed: false },
    });

    const inserts = [...first.calls, ...retry.calls]
      .map(sql)
      .filter((statement) =>
        statement.includes("INSERT INTO reef_notifications"),
      );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toContain("ON CONFLICT (notification_key) DO UPDATE");
    expect(inserts[0]).toContain(
      "SET notification_key = EXCLUDED.notification_key",
    );
    expect(existing.state).toBe("archived");
    expect(inserts[1]).toContain(
      buildNotificationKey({
        recipient: "bob",
        sourceType: "activity",
        sourceRef: String(activity.event_key),
      }),
    );
  });

  it("does not advance an issue-body source checkpoint when recipient fan-out fails", async () => {
    const activity = issueBodyMentionActivityRow(["bob", "carol"]);
    const first = setupActivityMentionProjectionFetch({
      activity: [activity],
      failRecipients: ["carol"],
    });
    await expect(project()).resolves.toMatchObject({
      activity: { failed: true, cursor: null },
    });
    expect(
      first.calls.filter((call) => sql(call).includes("UPDATE reef_settings")),
    ).toHaveLength(0);

    const retry = setupActivityMentionProjectionFetch({
      activity: [activity],
    });
    await expect(project()).resolves.toMatchObject({
      activity: { failed: false, fannedOut: 2 },
    });
    const retryInserts = retry.calls
      .map(sql)
      .filter((statement) =>
        statement.includes("INSERT INTO reef_notifications"),
      );
    expect(retryInserts).toHaveLength(2);
    expect(retryInserts.join("\n")).toContain("'bob'");
    expect(retryInserts.join("\n")).toContain("'carol'");
  });
});
