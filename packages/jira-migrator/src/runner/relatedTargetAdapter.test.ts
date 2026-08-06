import { AkbApiError } from "@reef/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAkbRelatedTarget } from "./relatedTargetAdapter.js";

const reconcileJiraImportedComment = vi.hoisted(() => vi.fn());
const reconcileJiraImportedAttachmentActivityActor = vi.hoisted(() => vi.fn());
const listIssueActivity = vi.hoisted(() => vi.fn());

vi.mock("@reef/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@reef/core")>();
  return {
    ...actual,
    akbListIssueActivity: listIssueActivity,
    akbReconcileJiraImportedAttachmentActivityActor:
      reconcileJiraImportedAttachmentActivityActor,
    akbReconcileJiraImportedComment: reconcileJiraImportedComment,
  };
});

describe("AKB Jira related target", () => {
  beforeEach(() => {
    reconcileJiraImportedAttachmentActivityActor.mockReset();
    reconcileJiraImportedComment.mockReset();
    listIssueActivity.mockReset();
  });

  it("retries transient AKB read failures without retrying a mutation", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new AkbApiError({ status: 0, message: "connect timeout" }),
      )
      .mockRejectedValueOnce(
        new AkbApiError({ status: 503, message: "temporarily unavailable" }),
      )
      .mockResolvedValue({
        kind: "table_query",
        items: [{ idempotency_key: "jira-remote:cloud:1:key" }],
      });
    const waitForConsistency = vi.fn(async () => undefined);
    const { related } = createAkbRelatedTarget({
      adapter: { request },
      vault: "reef-test",
      waitForConsistency,
      readIssue: async () => {
        throw new Error("unused");
      },
      updateIssue: async () => {
        throw new Error("unused");
      },
    });

    await expect(
      related.listExternalRefKeys("jira-remote:cloud:1:"),
    ).resolves.toEqual(["jira-remote:cloud:1:key"]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(waitForConsistency).toHaveBeenCalledTimes(2);
    expect(
      request.mock.calls.every(
        ([, init]) =>
          init &&
          typeof init === "object" &&
          "body" in init &&
          typeof init.body === "object" &&
          init.body !== null &&
          "sql" in init.body &&
          String(init.body.sql).startsWith("SELECT"),
      ),
    ).toBe(true);
  });

  it("loads planning catalogs with one query per catalog", async () => {
    const request = vi.fn(async (_path: string, init?: { body?: unknown }) => {
      const sql = String(
        (init?.body as { sql?: unknown } | undefined)?.sql ?? "",
      );
      if (sql.includes("FROM reef_activity")) {
        return {
          kind: "table_query",
          items: [
            {
              reef_id: "SHDEV-007",
              event_key:
                "attachment_added:file-1@2025-05-27T21:43:43.262+09:00",
              actor: "jira:account-1",
            },
          ],
        };
      }
      return {
        kind: "table_query",
        items: [
          { idempotency_key: "jira-remote:cloud:1:key" },
          { idempotency_key: "jira-remote:cloud:2:key" },
        ],
      };
    });
    const { related } = createAkbRelatedTarget({
      adapter: { request },
      vault: "reef-shdev",
      readIssue: async () => {
        throw new Error("unused");
      },
      updateIssue: async () => {
        throw new Error("unused");
      },
    });

    await expect(
      related.listAllFallbackAttachmentActivityActors?.(),
    ).resolves.toEqual([
      {
        reefId: "SHDEV-007",
        eventKey: "attachment_added:file-1@2025-05-27T21:43:43.262+09:00",
        actor: "jira:account-1",
      },
    ]);
    await expect(related.listAllExternalRefKeys?.()).resolves.toEqual([
      "jira-remote:cloud:1:key",
      "jira-remote:cloud:2:key",
    ]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("routes Jira comment remapping through the migration-owned repair path", async () => {
    reconcileJiraImportedComment.mockResolvedValue({
      id: "comment-1",
      reef_id: "SHDEV-007",
      body: "imported",
      author: "hongchan",
      created_at: "2025-05-27T21:43:43.262+09:00",
      edited_at: null,
      parent_comment_id: null,
      thread_root_id: null,
    });
    const adapter = { request: vi.fn() };
    const { related } = createAkbRelatedTarget({
      adapter,
      vault: "reef-shdev",
      readIssue: async () => {
        throw new Error("unused");
      },
      updateIssue: async () => {
        throw new Error("unused");
      },
    });

    await related.updateComment("comment-1", {
      idempotencyKey: "comment:cloud-1:15263:15578",
      reefId: "SHDEV-007",
      body: "imported",
      author: "hongchan",
      createdAt: "2025-05-27T21:43:43.262+09:00",
      editedAt: null,
      expectedThreadRootId: null,
    });

    expect(reconcileJiraImportedComment).toHaveBeenCalledWith(
      adapter,
      "reef-shdev",
      {
        commentId: "comment-1",
        reefId: "SHDEV-007",
        idempotencyKey: "comment:cloud-1:15263:15578",
        body: "imported",
        author: "hongchan",
        createdAt: "2025-05-27T21:43:43.262+09:00",
        editedAt: null,
      },
    );
  });

  it("routes attachment activity remapping through the migration-owned repair path", async () => {
    reconcileJiraImportedAttachmentActivityActor.mockResolvedValue(undefined);
    const adapter = { request: vi.fn() };
    const { related } = createAkbRelatedTarget({
      adapter,
      vault: "reef-shdev",
      readIssue: async () => {
        throw new Error("unused");
      },
      updateIssue: async () => {
        throw new Error("unused");
      },
    });
    const input = {
      reefId: "SHDEV-007",
      eventKey: "attachment_added:attachment-1@2025-05-27T21:43:43.262+09:00",
      fromActor: "jira:account-1",
      toActor: "hongchan",
    };

    await related.reconcileAttachmentActivityActor(input);

    expect(reconcileJiraImportedAttachmentActivityActor).toHaveBeenCalledWith(
      adapter,
      "reef-shdev",
      input,
    );
  });

  it("indexes activity readback once per issue and invalidates after a write", async () => {
    const expected = {
      reefId: "SHDEV-007",
      eventType: "status_change" as const,
      eventKey: "status_change:todo->done@2025-05-27T21:43:43.262+09:00",
      actor: "hongchan",
      at: "2025-05-27T21:43:43.262+09:00",
      source: "jira_import",
      payload: { from: "todo" as const, to: "done" as const },
    };
    listIssueActivity.mockResolvedValue([
      {
        id: "activity-1",
        reef_id: expected.reefId,
        event_type: expected.eventType,
        event_key: expected.eventKey,
        actor: expected.actor,
        at: expected.at,
        source: expected.source,
        payload: expected.payload,
      },
    ]);
    const target = createAkbRelatedTarget({
      adapter: { request: vi.fn() },
      vault: "reef-shdev",
      readIssue: async () => {
        throw new Error("unused");
      },
      updateIssue: async () => {
        throw new Error("unused");
      },
    });

    await expect(target.activityMatches([expected])).resolves.toBe(true);
    await expect(target.activityMatches([expected])).resolves.toBe(true);
    expect(listIssueActivity).toHaveBeenCalledTimes(1);

    target.invalidateActivityMatches([expected]);
    await expect(target.activityMatches([expected])).resolves.toBe(true);
    expect(listIssueActivity).toHaveBeenCalledTimes(2);
  });

  it("normalizes Unicode filenames and retries an eventually consistent activity readback", async () => {
    const expected = {
      reefId: "PROJ-241",
      eventType: "attachment_added" as const,
      eventKey: "jira-changelog:cloud:22044:102002:0:attachment_added",
      actor: "sehyeon@dnotitia.com",
      at: "2026-01-15T14:26:19.132+0900",
      source: "jira-changelog:changelog_history:cloud:22044:102002:0",
      payload: {
        attachment_id: "14594",
        file_uri: "akb://reef-target/coll/issues/proj-241/attachments/file/a",
        filename: "명세서 초안_P25078KR_3차수정_cleaned.docx".normalize("NFD"),
        mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size_bytes: 1,
      },
    };
    listIssueActivity.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "activity-1",
        reef_id: expected.reefId,
        event_type: expected.eventType,
        event_key: expected.eventKey,
        actor: expected.actor,
        at: expected.at,
        source: expected.source,
        payload: {
          ...expected.payload,
          filename: expected.payload.filename.normalize("NFC"),
        },
      },
    ]);
    const waitForConsistency = vi.fn(async () => undefined);
    const target = createAkbRelatedTarget({
      adapter: { request: vi.fn() },
      vault: "reef-target",
      waitForConsistency,
      readIssue: async () => {
        throw new Error("unused");
      },
      updateIssue: async () => {
        throw new Error("unused");
      },
    });

    await expect(target.activityMatches([expected])).resolves.toBe(true);
    expect(listIssueActivity).toHaveBeenCalledTimes(2);
    expect(waitForConsistency).toHaveBeenCalledTimes(1);
  });
});
