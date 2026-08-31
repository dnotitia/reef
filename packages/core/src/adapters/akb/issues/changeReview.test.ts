import { describe, expect, it } from "vitest";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  listIssueChangeReview,
  makeAdapter,
  makeIssueRow,
  setupFetch,
} from "../core/akb.testSupport";

const RANGE = {
  start_at: "2026-08-18T00:00:00.000Z",
  end_at: "2026-08-19T00:00:00.000Z",
};

const ISSUE_ONE: IssueMetadata = {
  id: "REEF-001",
  title: "Completed and archived issue",
  status: "done",
  issue_type: "story",
  created_at: "2026-08-17T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-08-20T00:00:00.000Z",
  updated_by: "alice",
  archived_at: "2026-08-20T00:00:00.000Z",
  labels: ["review"],
};

const ISSUE_TWO: IssueMetadata = {
  id: "REEF-002",
  title: "Closed issue",
  status: "closed",
  issue_type: "task",
  created_at: "2026-08-10T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-08-20T00:00:00.000Z",
  updated_by: "alice",
  closed_at: "2026-08-20T00:00:00.000Z",
  closed_reason: "completed",
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function mcpHistoryResponse(
  uri: string,
  history: readonly Record<string, unknown>[],
): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: "reef-akb_history",
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({ kind: "document_history", uri, history }),
        },
      ],
    },
  });
}

function issueHistory(hash: string, at: string, authorName = "alice") {
  return {
    hash,
    message: "Update issue body\n\naction: update\nagent: codex",
    author: "00000000-0000-4000-8000-000000000101",
    author_name: authorName,
    date: at,
  };
}

describe("listIssueChangeReview", () => {
  it("combines all sources by issue, filters the half-open range, and de-dupes", async () => {
    const issueRows = [
      makeIssueRow(ISSUE_ONE, {
        document_uri: "akb://reef-sample/coll/issues/doc/reef-001.md",
      }),
      makeIssueRow(ISSUE_TWO, {
        document_uri: "akb://reef-sample/coll/issues/doc/reef-002.md",
      }),
    ];
    const activity = [
      {
        id: "activity-status",
        reef_id: "REEF-001",
        event_type: "status_change",
        event_key: "status_change:todo->done@2026-08-18T00:00:00.000Z",
        payload: { from: "todo", to: "done" },
        meta: { actor: "alice", at: "2026-08-18T00:00:00.000Z", source: null },
      },
      {
        id: "activity-status-duplicate",
        reef_id: "REEF-001",
        event_type: "status_change",
        event_key: "status_change:todo->done@2026-08-18T00:00:00.000Z",
        payload: { from: "todo", to: "done" },
        meta: { actor: "alice", at: "2026-08-18T00:00:00.000Z", source: null },
      },
      {
        id: "activity-at-end",
        reef_id: "REEF-002",
        event_type: "priority_change",
        event_key: "priority_change:low->high@end",
        payload: { from: "low", to: "high" },
        meta: { actor: "alice", at: "2026-08-19T00:00:00.000Z", source: null },
      },
      {
        id: "activity-internal",
        reef_id: "REEF-001",
        event_type: "issue_body_mentions_change",
        event_key: "issue_body_mentions_change:commit-1",
        payload: {
          recipients: ["alice"],
          added: ["alice"],
          removed: [],
          document_commit: "commit-1",
        },
        meta: { actor: "alice", at: "2026-08-18T03:00:00.000Z", source: null },
      },
      {
        id: "activity-deleted-issue",
        reef_id: "REEF-999",
        event_type: "status_change",
        event_key: "status_change:todo->done:deleted",
        payload: { from: "todo", to: "done" },
        meta: { actor: "alice", at: "2026-08-18T04:00:00.000Z", source: null },
      },
    ];
    const comments = [
      {
        id: "comment-1",
        reef_id: "REEF-001",
        body: "Review comment stays in the group.",
        meta: {
          author: "bob",
          created_at: "2026-08-18T05:00:00.000Z",
          edited_at: null,
          parent_comment_id: null,
          thread_root_id: null,
        },
      },
      {
        id: "comment-outside",
        reef_id: "REEF-001",
        body: "This is outside the selected range.",
        meta: {
          author: "bob",
          created_at: "2026-08-19T00:00:00.000Z",
          edited_at: null,
          parent_comment_id: null,
          thread_root_id: null,
        },
      },
    ];
    const attachments = [
      {
        id: "attachment-1",
        reef_id: "REEF-001",
        file_uri: "akb://reef-sample/file/attachment-1",
        filename: "review.png",
        mime_type: "image/png",
        size_bytes: 20,
        author: "alice",
        created_at: "2026-08-18T06:00:00.000Z",
        source: "issue_body",
        inline: false,
        original_jira_attachment_id: null,
        meta: null,
      },
    ];
    const historyByUri = new Map<string, Record<string, unknown>[]>([
      [
        "akb://reef-sample/coll/issues/doc/reef-001.md",
        [
          issueHistory("metadata-only", "2026-08-18T07:00:00.000Z"),
          issueHistory("body-1", "2026-08-18T08:00:00.000Z"),
        ],
      ],
      ["akb://reef-sample/coll/issues/doc/reef-002.md", []],
    ]);
    const { fetchMock } = setupFetch([]);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/v1/tables/reef-sample/sql")) {
        const body = JSON.parse(String(init?.body)) as { sql: string };
        if (body.sql.includes("reef_issues")) {
          return jsonResponse({
            kind: "table_query",
            columns: Object.keys(issueRows[0] ?? {}),
            items: issueRows,
            total: issueRows.length,
          });
        }
        if (body.sql.includes("reef_activity")) {
          return jsonResponse({
            kind: "table_query",
            columns: [
              "id",
              "reef_id",
              "event_type",
              "event_key",
              "payload",
              "meta",
            ],
            items: activity,
            total: activity.length,
          });
        }
        if (body.sql.includes("reef_comments")) {
          return jsonResponse({
            kind: "table_query",
            columns: ["id", "reef_id", "body", "meta"],
            items: comments,
            total: comments.length,
          });
        }
        if (body.sql.includes("reef_attachments")) {
          return jsonResponse({
            kind: "table_query",
            columns: [
              "id",
              "reef_id",
              "file_uri",
              "filename",
              "mime_type",
              "size_bytes",
              "author",
              "created_at",
              "source",
              "inline",
              "original_jira_attachment_id",
              "meta",
            ],
            items: attachments,
            total: attachments.length,
          });
        }
      }
      if (url === "https://akb.test/mcp/") {
        const body = JSON.parse(String(init?.body)) as {
          params?: { arguments?: { uri?: string } };
        };
        const uri = body.params?.arguments?.uri;
        return mcpHistoryResponse(uri ?? "", historyByUri.get(uri ?? "") ?? []);
      }
      if (url.includes("/api/v1/diff/")) {
        const commit = new URL(url).searchParams.get("commit");
        const diff =
          commit === "metadata-only"
            ? [
                "--- a/issues/reef-001.md",
                "+++ b/issues/reef-001.md",
                "@@ -1,5 +1,5 @@",
                " ---",
                "-title: old",
                "+title: new",
                " type: task",
                " ---",
                " Same body",
              ].join("\n")
            : [
                "--- a/issues/reef-001.md",
                "+++ b/issues/reef-001.md",
                "@@ -1,5 +1,5 @@",
                " ---",
                " title: new",
                " type: task",
                " ---",
                "-Old body",
                "+New body",
              ].join("\n");
        return jsonResponse({
          file: "issues/reef-001.md",
          commit,
          type: "modified",
          diff,
        });
      }
      throw new Error(`Unexpected fetch in change review test: ${url}`);
    });

    const result = await listIssueChangeReview({
      adapter: makeAdapter(),
      vault: "reef-sample",
      range: RANGE,
    });

    expect(result.start_at).toBe(RANGE.start_at);
    expect(result.end_at).toBe(RANGE.end_at);
    expect(result.groups.map((group) => group.issue.id)).toEqual(["REEF-001"]);
    const changes = result.groups[0]?.changes ?? [];
    expect(changes.map((change) => change.kind)).toEqual([
      "field_change",
      "comment_added",
      "attachment_added",
      "body_update",
    ]);
    expect(changes[0]).toMatchObject({
      kind: "field_change",
      event_type: "status_change",
      from: "todo",
      to: "done",
    });
    expect(changes[1]).toMatchObject({
      kind: "comment_added",
      body: "Review comment stays in the group.",
    });
    expect(changes[2]).toMatchObject({
      kind: "attachment_added",
      filename: "review.png",
    });
    expect(changes[3]).toMatchObject({
      kind: "body_update",
      hash: "body-1",
      diff: "-Old body\n+New body",
    });
    expect(changes.some((change) => change.kind === "created")).toBe(false);
    expect(
      changes.some(
        (change) =>
          change.kind === "field_change" &&
          change.event_type === "issue_body_mentions_change",
      ),
    ).toBe(false);
    expect(
      changes.some(
        (change) =>
          change.kind === "body_update" && change.hash === "metadata-only",
      ),
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://akb.test/mcp/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "mcp-protocol-version": "2026-07-28",
          "mcp-method": "tools/call",
          "mcp-name": "akb_history",
        }),
      }),
    );
  });

  it("rejects an empty or reversed range before reading the vault", async () => {
    const { calls } = setupFetch([]);
    await expect(
      listIssueChangeReview({
        adapter: makeAdapter(),
        vault: "reef-sample",
        range: {
          start_at: "2026-08-19T00:00:00.000Z",
          end_at: "2026-08-19T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
