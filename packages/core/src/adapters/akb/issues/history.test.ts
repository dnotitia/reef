import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../errors";
import type { AkbDocumentHistoryEntry } from "../../../schemas/issues/history";
import {
  listIssueBodyHistory,
  parseHistoryTrailers,
  projectIssueBodyHistoryEntry,
} from "./history";
import { makeAdapter, setupFetch } from "../core/httpTestSupport";

const ISSUE_URI = "akb://reef-sample/coll/issues/doc/reef-127.md";

function entry(
  overrides: Partial<AkbDocumentHistoryEntry> = {},
): AkbDocumentHistoryEntry {
  return {
    hash: "commit-1",
    message: "Update body\n\naction: update\nagent: codex",
    author: "9b2f1d27-6ca8-4b2a-8b1f-3e9f6d4b8c20",
    author_name: null,
    date: "2026-08-18T01:00:00.000Z",
    ...overrides,
  };
}

describe("parseHistoryTrailers", () => {
  it("reads exact action and agent trailer keys from the trailing block", () => {
    expect(
      parseHistoryTrailers("Body action: move\n\naction: update\nagent: codex"),
    ).toEqual({ action: "update", agent: "codex" });
  });

  it("does not treat lookalike keys or a body line as trailers", () => {
    expect(
      parseHistoryTrailers("x-action: update\n\nmessage body action: update"),
    ).toEqual({ action: null, agent: null });
  });
});

describe("projectIssueBodyHistoryEntry", () => {
  it("filters non-update actions and uses author_name before agent", () => {
    expect(
      projectIssueBodyHistoryEntry(
        entry({
          author_name: "Alice Example",
          message: "x\n\naction: update\nagent: codex",
        }),
      ),
    ).toMatchObject({
      id: "body-update:commit-1",
      hash: "commit-1",
      actor: "Alice Example",
      kind: "body_update",
    });
    expect(
      projectIssueBodyHistoryEntry(entry({ message: "x\n\naction: create" })),
    ).toBeNull();
  });

  it("falls back to agent and hides unknown or raw UUID actors", () => {
    expect(
      projectIssueBodyHistoryEntry(
        entry({
          author_name: null,
          message: "x\n\naction: update\nagent: codex",
        }),
      ),
    ).toMatchObject({ actor: "codex" });
    expect(
      projectIssueBodyHistoryEntry(
        entry({
          author_name: null,
          message: "x\n\naction: update",
          author: "9b2f1d27-6ca8-4b2a-8b1f-3e9f6d4b8c20",
        }),
      ),
    ).toMatchObject({ actor: null });
  });
});

describe("listIssueBodyHistory", () => {
  it("calls canonical history with limit 100 and skips malformed/noise entries", async () => {
    const { calls } = setupFetch([
      {
        body: {
          kind: "document_history",
          uri: ISSUE_URI,
          history: [
            entry({ hash: "update-1", author_name: "alice" }),
            entry({ hash: "create-1", message: "x\n\naction: create" }),
            entry({
              hash: "update-2",
              author_name: null,
              message: "x\n\naction: update\nagent: codex",
            }),
            { hash: "bad", message: "x", author: "alice" },
          ],
        },
      },
    ]);

    await expect(
      listIssueBodyHistory(makeAdapter(), "reef-sample", "REEF-127"),
    ).resolves.toEqual([
      expect.objectContaining({ id: "body-update:update-1", actor: "alice" }),
      expect.objectContaining({ id: "body-update:update-2", actor: "codex" }),
    ]);
    expect(calls[0]?.url).toBe(
      "https://akb.test/api/v1/history/reef-sample/issues/reef-127.md?limit=100",
    );
  });

  it("fails the history query when the response envelope is invalid", async () => {
    setupFetch([
      {
        body: { kind: "document_history", uri: ISSUE_URI, history: "bad" },
      },
    ]);

    await expect(
      listIssueBodyHistory(makeAdapter(), "reef-sample", "REEF-127"),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });
});
