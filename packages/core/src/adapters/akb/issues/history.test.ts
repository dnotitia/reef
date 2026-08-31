import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../errors";
import type { AkbDocumentHistoryEntry } from "../../../schemas/issues/history";
import {
  bodyDiffFromDocumentDiff,
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

describe("bodyDiffFromDocumentDiff", () => {
  it("drops AKB frontmatter changes while retaining the Markdown body diff", () => {
    expect(
      bodyDiffFromDocumentDiff(
        [
          "--- a/issues/reef-127.md",
          "+++ b/issues/reef-127.md",
          "@@ -1,6 +1,6 @@",
          " ---",
          "-title: Old title",
          "+title: New title",
          " type: task",
          " ---",
          "-Old body",
          "+New body",
        ].join("\n"),
      ),
    ).toBe("-Old body\n+New body");
  });

  it("returns null when an update only changes document metadata", () => {
    expect(
      bodyDiffFromDocumentDiff(
        [
          "--- a/issues/reef-127.md",
          "+++ b/issues/reef-127.md",
          "@@ -1,5 +1,5 @@",
          " ---",
          "-title: Old title",
          "+title: New title",
          " type: task",
          " ---",
          " Same body",
        ].join("\n"),
      ),
    ).toBeNull();
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

  it("uses stateless MCP for complete history and excludes metadata-only document updates", async () => {
    const history = [
      entry({
        hash: "metadata-only",
        date: "2026-08-18T03:00:00.000Z",
      }),
      entry({
        hash: "body-update",
        date: "2026-08-18T02:00:00.000Z",
      }),
      entry({
        hash: "create",
        date: "2026-08-18T01:00:00.000Z",
        message: "Create issue\n\naction: create",
      }),
    ];
    const mcpResult = {
      jsonrpc: "2.0",
      id: "reef-akb_history",
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              kind: "document_history",
              uri: ISSUE_URI,
              history,
            }),
          },
        ],
      },
    };
    const { calls } = setupFetch([
      { body: mcpResult },
      {
        body: {
          file: "issues/reef-127.md",
          commit: "metadata-only",
          type: "modified",
          diff: [
            "--- a/issues/reef-127.md",
            "+++ b/issues/reef-127.md",
            "@@ -1,5 +1,5 @@",
            " ---",
            "-title: Old title",
            "+title: New title",
            " type: task",
            " ---",
            " Same body",
          ].join("\n"),
        },
      },
      {
        body: {
          file: "issues/reef-127.md",
          commit: "body-update",
          type: "modified",
          diff: [
            "--- a/issues/reef-127.md",
            "+++ b/issues/reef-127.md",
            "@@ -1,5 +1,5 @@",
            " ---",
            " title: New title",
            " type: task",
            " ---",
            "-Old body",
            "+New body",
          ].join("\n"),
        },
      },
    ]);

    await expect(
      listIssueBodyHistory(makeAdapter(), "reef-sample", "REEF-127", {
        complete: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "body-update:body-update",
        hash: "body-update",
        diff: "-Old body\n+New body",
      }),
    ]);

    expect(calls[0]?.url).toBe("https://akb.test/mcp/");
    expect(calls[0]?.init?.headers).toMatchObject({
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/call",
      "mcp-name": "akb_history",
    });
    const request = JSON.parse(String(calls[0]?.init?.body)) as {
      method: string;
      params: {
        name: string;
        arguments: { uri: string; limit: number };
        _meta: Record<string, unknown>;
      };
    };
    expect(request.method).toBe("tools/call");
    expect(request.params.name).toBe("akb_history");
    expect(request.params.arguments).toEqual({
      uri: ISSUE_URI,
      limit: 2_147_483_647,
    });
    expect(request.params._meta).toMatchObject({
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    });
    expect(calls[1]?.url).toBe(
      "https://akb.test/api/v1/diff/reef-sample/issues/reef-127.md?commit=metadata-only",
    );
    expect(calls[2]?.url).toBe(
      "https://akb.test/api/v1/diff/reef-sample/issues/reef-127.md?commit=body-update",
    );
  });
});
