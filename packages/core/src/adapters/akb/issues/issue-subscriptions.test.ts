import { describe, expect, it } from "vitest";
import { akbGetEffectiveSubscriptionState } from "../../../index";
import { buildSubscriptionKey } from "../../../schemas/notifications";
import {
  ALL_REEF_TABLES,
  ISSUE_ROW_COLUMNS,
  SAMPLE_ISSUE,
  createComment,
  makeAdapter,
  makeDocumentResponse,
  makeIssueRow,
  makeListTablesResponse,
  makePutResponse,
  makeSqlMutationResponse,
  makeSqlQueryResponse,
  setupFetch,
  sqlRequestBody,
  updateComment,
  updateIssue,
  writeIssue,
} from "../core/akb.testSupport";

const SUBSCRIPTION_ROW_COLUMNS = [
  "id",
  "subscription_key",
  "reef_id",
  "subscriber",
  "source",
  "status",
  "subscribed_at",
  "meta",
];

const COMMENT_ROW_COLUMNS = [
  "id",
  "reef_id",
  "body",
  "meta",
  "created_at",
  "updated_at",
  "created_by",
];

function subscriptionRow(
  subscriber: string,
  source: "manual" | "requester" | "assignee" | "commenter",
  status: "active" | "muted" = "active",
) {
  return {
    id: "018f47a4-8e3b-7f62-a3d2-9876543210ab",
    subscription_key: buildSubscriptionKey({
      reefId: "REEF-001",
      subscriber,
      source,
    }),
    reef_id: "REEF-001",
    subscriber,
    source,
    status,
    subscribed_at: "2026-07-30T00:00:00.000Z",
    meta: null,
  };
}

function commentRow(author: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reef_id: "REEF-001",
    body: "a comment",
    meta: {
      author,
      created_at: "2026-07-30T00:00:00.000Z",
      edited_at: null,
      parent_comment_id: null,
      thread_root_id: null,
    },
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    created_by: "akb-principal",
    ...overrides,
  };
}

function sql(call: Parameters<typeof sqlRequestBody>[0]): string {
  return sqlRequestBody(call).sql;
}

describe("automatic issue-participant subscriptions (REEF-429)", () => {
  it("creates requester and assignee sources", async () => {
    const issue = {
      ...SAMPLE_ISSUE,
      requester: "requester",
      assigned_to: "assignee",
    };
    const { calls } = setupFetch([
      { status: 201, body: makePutResponse() },
      { body: makeSqlMutationResponse("INSERT 0 1") },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("requester", "requester")],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("assignee", "assignee")],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
    ]);

    await writeIssue({
      adapter: makeAdapter(),
      vault: "reef-sample",
      issue,
    });

    expect(calls).toHaveLength(4);
    const subscriptionRequests = [
      sqlRequestBody(calls[2]),
      sqlRequestBody(calls[3]),
    ];
    expect(
      subscriptionRequests.every((request) =>
        String(request.sql).includes(
          "ON CONFLICT (subscription_key) DO UPDATE",
        ),
      ),
    ).toBe(true);
    expect(subscriptionRequests[0].params).toEqual(
      expect.arrayContaining(["REEF-001", "requester", "active"]),
    );
    expect(subscriptionRequests[1].params).toEqual(
      expect.arrayContaining(["REEF-001", "assignee", "active"]),
    );
    expect(
      subscriptionRequests.map((request) => String(request.sql)).join("\n"),
    ).not.toContain("'manual'");
  });

  it("reapplies matching requester and assignee values through the existing source keys", async () => {
    const issue = {
      ...SAMPLE_ISSUE,
      requester: "requester",
      assigned_to: "assignee",
    };
    const { calls } = setupFetch([
      { body: makeDocumentResponse() },
      { body: makeSqlQueryResponse([makeIssueRow(issue)], ISSUE_ROW_COLUMNS) },
      { body: makeSqlMutationResponse("UPDATE 1") },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("requester", "requester")],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("assignee", "assignee")],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
      {
        body: makeSqlQueryResponse(
          [
            subscriptionRow("requester", "manual", "muted"),
            subscriptionRow("requester", "requester"),
          ],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
    ]);

    await updateIssue({
      adapter: makeAdapter(),
      vault: "reef-sample",
      id: "REEF-001",
      partial: { requester: "requester", assigned_to: "assignee" },
    });
    const state = await akbGetEffectiveSubscriptionState(
      makeAdapter(),
      "reef-sample",
      { reefId: "REEF-001", subscriber: "requester" },
    );

    expect(calls).toHaveLength(6);
    const subscriptionRequests = [
      sqlRequestBody(calls[3]),
      sqlRequestBody(calls[4]),
    ];
    expect(
      subscriptionRequests.every((request) =>
        String(request.sql).includes(
          "ON CONFLICT (subscription_key) DO UPDATE",
        ),
      ),
    ).toBe(true);
    expect(subscriptionRequests[0].params).toEqual(
      expect.arrayContaining(["REEF-001", "requester", "active"]),
    );
    expect(subscriptionRequests[1].params).toEqual(
      expect.arrayContaining(["REEF-001", "assignee", "active"]),
    );
    expect(state).toBe("muted");
  });

  it("replaces and removes only the affected automatic source", async () => {
    const current = {
      ...SAMPLE_ISSUE,
      requester: "requester",
      assigned_to: "assignee",
    };
    const { calls } = setupFetch([
      { body: makeDocumentResponse() },
      {
        body: makeSqlQueryResponse([makeIssueRow(current)], ISSUE_ROW_COLUMNS),
      },
      { body: makeSqlMutationResponse("UPDATE 1") },
      { body: makeSqlQueryResponse([{ id: "removed-requester" }], ["id"]) },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("replacement", "requester")],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
      { body: makeSqlQueryResponse([{ id: "removed-assignee" }], ["id"]) },
    ]);

    await updateIssue({
      adapter: makeAdapter(),
      vault: "reef-sample",
      id: "REEF-001",
      partial: { requester: "replacement", assigned_to: null },
    });

    const lifecycleRequests = calls.slice(3).map(sqlRequestBody);
    expect(lifecycleRequests).toHaveLength(3);
    expect(String(lifecycleRequests[0].sql)).toContain(
      "DELETE FROM reef_subscriptions",
    );
    expect(lifecycleRequests[0].params).toEqual([
      "REEF-001",
      "requester",
      "requester",
    ]);
    expect(lifecycleRequests[1].params).toEqual(
      expect.arrayContaining([
        "REEF-001",
        "replacement",
        "requester",
        "active",
      ]),
    );
    expect(String(lifecycleRequests[2].sql)).toContain(
      "DELETE FROM reef_subscriptions",
    );
    expect(lifecycleRequests[2].params).toEqual([
      "REEF-001",
      "assignee",
      "assignee",
    ]);
    expect(
      lifecycleRequests.map((request) => String(request.sql)).join("\n"),
    ).not.toContain("'manual'");
  });

  it("creates commenter sources for comments and replies, but never for an edit", async () => {
    const root = commentRow("root-author", { body: "root" });
    const reply = commentRow("reply-author", {
      id: "22222222-2222-4222-8222-222222222222",
      body: "reply",
      meta: {
        author: "reply-author",
        created_at: "2026-07-30T00:01:00.000Z",
        edited_at: null,
        parent_comment_id: "11111111-1111-4111-8111-111111111111",
        thread_root_id: "11111111-1111-4111-8111-111111111111",
      },
    });
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse([root], COMMENT_ROW_COLUMNS),
      },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("root-author", "commenter")],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSqlQueryResponse([reply], COMMENT_ROW_COLUMNS) },
      {
        body: makeSqlQueryResponse(
          [subscriptionRow("reply-author", "commenter")],
          SUBSCRIPTION_ROW_COLUMNS,
        ),
      },
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      {
        body: makeSqlQueryResponse(
          [commentRow("root-author", { body: "edited root" })],
          COMMENT_ROW_COLUMNS,
        ),
      },
    ]);

    await createComment(
      makeAdapter(),
      "reef-sample",
      "REEF-001",
      "root",
      "root-author",
      undefined,
      {
        createdAt: "2026-07-30T00:00:00.000Z",
        editedAt: null,
      },
    );
    expect(calls).toHaveLength(3);
    await createComment(
      makeAdapter(),
      "reef-sample",
      "REEF-001",
      "reply",
      "reply-author",
      "11111111-1111-4111-8111-111111111111",
      {
        createdAt: "2026-07-30T00:01:00.000Z",
        editedAt: null,
      },
    );
    expect(calls).toHaveLength(6);
    await updateComment(
      makeAdapter(),
      "reef-sample",
      "REEF-001",
      "11111111-1111-4111-8111-111111111111",
      "edited root",
      "root-author",
    );

    expect(calls).toHaveLength(8);
    const subscriptionRequests = calls.filter(
      (call) =>
        call.url.includes("/sql") && sql(call).includes("reef_subscriptions"),
    );
    expect(subscriptionRequests).toHaveLength(2);
    expect(sqlRequestBody(subscriptionRequests[0]).params).toEqual(
      expect.arrayContaining(["root-author", "commenter"]),
    );
    expect(sqlRequestBody(subscriptionRequests[1]).params).toEqual(
      expect.arrayContaining(["reply-author", "commenter"]),
    );
    expect(
      subscriptionRequests.every((call) =>
        sqlRequestBody(call).params?.includes("commenter"),
      ),
    ).toBe(true);
  });
});
