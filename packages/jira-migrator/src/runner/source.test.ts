import { describe, expect, it, vi } from "vitest";
import type { JiraPage, JiraRateLimit } from "../jira/client.js";
import {
  assertUniqueJiraIssues,
  readAllChangelog,
  readAllProjectIssues,
  readBoardSprints,
} from "./source.js";
import { runnerArchivePermissionVerification } from "./sourceArchive.js";
import { assertCachedAttachmentWithinLimit } from "./sourceSnapshot.js";

const rateLimit: JiraRateLimit = {
  limit: null,
  remaining: null,
  reset: null,
  nearLimit: false,
  retryAfterSeconds: null,
};

describe("runner source traversal", () => {
  it("fails closed without a verified Windows archive ACL", () => {
    expect(() => runnerArchivePermissionVerification("win32")).toThrow(
      "windows_external_acl_verification_required",
    );
    expect(runnerArchivePermissionVerification("linux")).toEqual({
      kind: "posix_mode",
      verified: true,
    });
  });

  it("enforces attachment limits for cached source bytes", () => {
    expect(() => assertCachedAttachmentWithinLimit(0, 0)).toThrow(
      "jira_attachment_size_limit_invalid",
    );
    expect(() => assertCachedAttachmentWithinLimit(3, 2)).toThrow(
      "jira_attachment_size_limit_exceeded",
    );
    expect(() => assertCachedAttachmentWithinLimit(2, 2)).not.toThrow();
  });

  it("rejects duplicate Jira issue ids or keys across source catalogs", () => {
    expect(() =>
      assertUniqueJiraIssues([
        { id: "10001", key: "ALPHA-1" },
        { id: "10001", key: "BETA-1" },
      ] as never),
    ).toThrow("jira_issue_catalog_duplicate");
    expect(() =>
      assertUniqueJiraIssues([
        { id: "10001", key: "ALPHA-1" },
        { id: "20001", key: "ALPHA-1" },
      ] as never),
    ).toThrow("jira_issue_catalog_duplicate");
  });

  it("follows enhanced-JQL nextPageToken once and rejects repeated tokens", async () => {
    const searchProjectIssues = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: "10001", key: "ALPHA-1" }],
        cursor: { kind: "nextPageToken", value: "next-1" },
        isLast: false,
        rateLimit,
        raw: { issues: [] },
      })
      .mockResolvedValueOnce({
        items: [{ id: "10002", key: "ALPHA-2" }],
        cursor: null,
        isLast: true,
        rateLimit,
        raw: { issues: [] },
      });

    const result = await readAllProjectIssues(
      { searchProjectIssues } as never,
      "ALPHA",
      { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    );
    expect(result.items.map((item) => (item as { key: string }).key)).toEqual([
      "ALPHA-1",
      "ALPHA-2",
    ]);
    expect(searchProjectIssues).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ nextPageToken: "next-1" }),
    );

    searchProjectIssues.mockReset().mockResolvedValue({
      items: [],
      cursor: { kind: "nextPageToken", value: "same" },
      isLast: false,
      rateLimit,
      raw: {},
    } satisfies JiraPage<never>);
    await expect(
      readAllProjectIssues({ searchProjectIssues } as never, "ALPHA", {
        maxRetries: 0,
        baseDelayMs: 0,
        maxDelayMs: 0,
      }),
    ).rejects.toThrow("jira_issue_pagination_token_repeated");
  });

  it("rejects inconsistent enhanced-JQL terminal state", async () => {
    const retry = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };
    const searchProjectIssues = vi.fn();

    searchProjectIssues.mockResolvedValueOnce({
      items: [],
      cursor: null,
      isLast: false,
      rateLimit,
      raw: {},
    });
    await expect(
      readAllProjectIssues({ searchProjectIssues } as never, "ALPHA", retry),
    ).rejects.toThrow("jira_issue_pagination_cursor_missing");

    searchProjectIssues.mockResolvedValueOnce({
      items: [],
      cursor: { kind: "nextPageToken", value: "unexpected" },
      isLast: true,
      rateLimit,
      raw: {},
    });
    await expect(
      readAllProjectIssues({ searchProjectIssues } as never, "ALPHA", retry),
    ).rejects.toThrow("jira_issue_pagination_terminal_with_cursor");
  });

  it("reads only explicit boards and preserves their selection provenance", async () => {
    const readBoardSprintCatalog = vi.fn(async (boardId: string) => ({
      items: [{ id: boardId, name: `Sprint ${boardId}` }],
      pages: [],
      rateLimits: [],
    }));
    const result = await readBoardSprints(
      { readBoardSprintCatalog } as never,
      ["42", "7"],
      { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    );
    expect(result.map((item) => item.boardId)).toEqual(["42", "7"]);
    expect(readBoardSprintCatalog).toHaveBeenCalledTimes(2);
  });

  it("walks changelog startAt pages and rejects a non-advancing cursor", async () => {
    const listChangelog = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: "h-1" }],
        cursor: { kind: "startAt", value: 2 },
        isLast: false,
        rateLimit,
        raw: { startAt: 0 },
      })
      .mockResolvedValueOnce({
        items: [{ id: "h-2" }],
        cursor: null,
        isLast: true,
        rateLimit,
        raw: { startAt: 2 },
      });
    const result = await readAllChangelog(
      { listChangelog } as never,
      "ALPHA-1",
      { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    );
    expect(result.items.map((item) => (item as { id: string }).id)).toEqual([
      "h-1",
      "h-2",
    ]);
    expect(listChangelog).toHaveBeenNthCalledWith(2, "ALPHA-1", {
      startAt: 2,
    });

    listChangelog.mockReset().mockResolvedValue({
      items: [],
      cursor: { kind: "startAt", value: 0 },
      isLast: false,
      rateLimit,
      raw: {},
    });
    await expect(
      readAllChangelog({ listChangelog } as never, "ALPHA-1", {
        maxRetries: 0,
        baseDelayMs: 0,
        maxDelayMs: 0,
      }),
    ).rejects.toThrow("jira_changelog_pagination_did_not_advance");
  });

  it("rejects inconsistent changelog terminal state", async () => {
    const retry = { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 };
    const listChangelog = vi.fn();

    listChangelog.mockResolvedValueOnce({
      items: [],
      cursor: null,
      isLast: false,
      rateLimit,
      raw: {},
    });
    await expect(
      readAllChangelog({ listChangelog } as never, "ALPHA-1", retry),
    ).rejects.toThrow("jira_changelog_pagination_cursor_missing");

    listChangelog.mockResolvedValueOnce({
      items: [],
      cursor: { kind: "startAt", value: 1 },
      isLast: true,
      rateLimit,
      raw: {},
    });
    await expect(
      readAllChangelog({ listChangelog } as never, "ALPHA-1", retry),
    ).rejects.toThrow("jira_changelog_pagination_terminal_with_cursor");
  });
});
