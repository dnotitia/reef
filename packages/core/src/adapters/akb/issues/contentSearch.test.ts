import { describe, expect, it, vi } from "vitest";
import { AkbApiError } from "../../../errors";
import type { AkbAdapter, AkbRequestInit } from "../core/http";
import { buildContentSearchSnippet, searchIssueContent } from "./contentSearch";

function issueRow(
  id: string,
  documentUri: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    document_uri: documentUri,
    reef_id: id,
    title: `Title ${id}`,
    status: "todo",
    issue_type: "task",
    archived_at: null,
    labels: [],
    depends_on: [],
    blocks: [],
    related_to: [],
    meta: { author: "alice", last_editor: "alice" },
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function table(items: Record<string, unknown>[]) {
  return {
    kind: "table_query",
    columns: items.length > 0 ? Object.keys(items[0]) : [],
    items,
    total: items.length,
  };
}

function makeAdapter(options?: {
  degraded?: boolean;
  missingComments?: boolean;
  bodyHits?: Array<{
    uri: string;
    title: string;
    score: number;
    matched_section: string;
  }>;
  bodyRows?: Record<string, unknown>[];
  commentRows?: Record<string, unknown>[];
}): { adapter: AkbAdapter; request: ReturnType<typeof vi.fn> } {
  const bodyUri = "akb://reef/coll/issues/doc/reef-001.md";
  const request = vi.fn(
    async (path: string, init?: AkbRequestInit): Promise<unknown> => {
      if (path === "/api/v1/search") {
        const results = options?.bodyHits ?? [
          {
            uri: bodyUri,
            title: "REEF-001",
            score: 0.8,
            matched_section:
              "## Internal heading\n한국어 시맨틱 본문 검색 문구입니다.",
          },
        ];
        return {
          kind: "search",
          returned: results.length,
          truncated: false,
          degraded: options?.degraded ?? false,
          results,
        };
      }
      const body =
        init?.body && typeof init.body === "object"
          ? (init.body as Record<string, unknown>)
          : {};
      const sql = String(body.sql ?? "");
      if (sql.includes("FROM reef_comments")) {
        if (options?.missingComments) {
          return { error: 'relation "reef_comments" does not exist' };
        }
        return table(
          options?.commentRows ?? [
            {
              id: "comment-new",
              reef_id: "REEF-002",
              body: "English comment-only needle",
              created_at: "2026-07-02T00:00:00.000Z",
            },
            {
              id: "comment-old",
              reef_id: "REEF-002",
              body: "Older English comment-only needle",
              created_at: "2026-07-01T00:00:00.000Z",
            },
          ],
        );
      }
      if (sql.includes("document_uri IN")) {
        return table(options?.bodyRows ?? [issueRow("REEF-001", bodyUri)]);
      }
      if (sql.includes("reef_id IN")) {
        return table([
          issueRow("REEF-002", "akb://reef/coll/issues/doc/reef-002.md"),
        ]);
      }
      throw new Error(`Unexpected request: ${path} ${sql}`);
    },
  );
  return { adapter: { request }, request };
}

describe("searchIssueContent", () => {
  it("hydrates body relevance order, keeps the newest comment per issue, and normalizes heading markers", async () => {
    const { adapter, request } = makeAdapter();
    const result = await searchIssueContent({
      adapter,
      vault: "reef",
      query: "needle",
      limit: 10,
    });

    expect(result).toEqual({
      results: [
        {
          reef_id: "REEF-001",
          title: "Title REEF-001",
          snippet: "Internal heading 한국어 시맨틱 본문 검색 문구입니다.",
          source: "body",
          score: 0.8,
          match_id: "body:akb://reef/coll/issues/doc/reef-001.md",
        },
        {
          reef_id: "REEF-002",
          title: "Title REEF-002",
          snippet: "English comment-only needle",
          source: "comment",
          score: null,
          match_id: "comment:comment-new",
        },
      ],
      has_more: false,
    });
    const searchCall = request.mock.calls.find(
      ([path]) => path === "/api/v1/search",
    );
    expect(searchCall?.[1]?.query).toMatchObject({
      vault: "reef",
      collection: "issues",
      type: "task",
      q: "needle",
      limit: 10,
    });
  });

  it("escapes %, _, and backslash as literal ILIKE input using the SQL quote helper", async () => {
    const { adapter, request } = makeAdapter({ commentRows: [] });
    await searchIssueContent({
      adapter,
      vault: "reef",
      query: "%_\\[",
      limit: 10,
    });
    const commentCall = request.mock.calls.find(([, init]) =>
      String(init?.body?.sql ?? "").includes("FROM reef_comments"),
    );
    expect(commentCall?.[1]?.body?.sql).toContain(
      "ILIKE '%\\%\\_\\\\[%' ESCAPE '\\'",
    );
    expect(commentCall?.[1]?.body?.sql).toContain(
      "ROW_NUMBER() OVER (\n                PARTITION BY reef_id",
    );
    expect(commentCall?.[1]?.body?.sql).toContain("WHERE issue_rank = 1");
  });

  it("drops missing, archived, and malformed issue rows without failing the response", async () => {
    const bodyUri = "akb://reef/coll/issues/doc/reef-001.md";
    const { adapter } = makeAdapter({
      bodyRows: [
        issueRow("REEF-001", bodyUri, {
          archived_at: "2026-07-03T00:00:00.000Z",
        }),
        issueRow("REEF-BAD", bodyUri, { status: "invalid" }),
      ],
      commentRows: [],
    });
    await expect(
      searchIssueContent({
        adapter,
        vault: "reef",
        query: "needle",
        limit: 10,
      }),
    ).resolves.toEqual({ results: [], has_more: false });
  });

  it("keeps body results when the comment table is missing", async () => {
    const { adapter } = makeAdapter({ missingComments: true });
    const result = await searchIssueContent({
      adapter,
      vault: "reef",
      query: "needle",
      limit: 10,
    });
    expect(result.results.map((item) => item.source)).toEqual(["body"]);
  });

  it("does not let a full body top-K starve comment matches", async () => {
    const bodyHits = Array.from({ length: 10 }, (_, index) => ({
      uri: `akb://reef/coll/issues/doc/reef-${100 + index}.md`,
      title: `REEF-${100 + index}`,
      score: 1 - index / 100,
      matched_section: `Body needle ${index}`,
    }));
    const { adapter } = makeAdapter({
      bodyHits,
      bodyRows: bodyHits.map((hit, index) =>
        issueRow(`REEF-${100 + index}`, hit.uri),
      ),
      commentRows: [
        {
          id: "comment-visible",
          reef_id: "REEF-002",
          body: "Comment needle remains visible",
          created_at: "2026-07-03T00:00:00.000Z",
        },
      ],
    });

    const result = await searchIssueContent({
      adapter,
      vault: "reef",
      query: "needle",
      limit: 10,
    });

    expect(result.results).toHaveLength(10);
    expect(result.results.map((item) => item.source).slice(0, 2)).toEqual([
      "body",
      "comment",
    ]);
    expect(result.results).toContainEqual(
      expect.objectContaining({ match_id: "comment:comment-visible" }),
    );
  });

  it("fails the whole content search when AKB hybrid search is degraded", async () => {
    const { adapter } = makeAdapter({ degraded: true });
    await expect(
      searchIssueContent({
        adapter,
        vault: "reef",
        query: "needle",
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(AkbApiError);
  });

  it("normalizes and bounds snippets around a literal match", () => {
    const snippet = buildContentSearchSnippet(
      `${"before ".repeat(80)}Needle${" after".repeat(80)}`,
      "needle",
    );
    expect(snippet.length).toBeLessThanOrEqual(282);
    expect(snippet).toContain("Needle");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("retains text that appears only in a Markdown heading", () => {
    expect(buildContentSearchSnippet("## Deployment", "deployment")).toBe(
      "Deployment",
    );
  });

  it("preserves literal matching whitespace when bounding a comment snippet", () => {
    const snippet = buildContentSearchSnippet(
      `${"before ".repeat(80)}foo  bar${" after".repeat(80)}`,
      "foo  bar",
    );
    expect(snippet).toContain("foo  bar");
  });

  it("maps length-changing Unicode case folds back to source offsets", () => {
    const snippet = buildContentSearchSnippet(
      `${"İ".repeat(180)}Needle${" after".repeat(80)}`,
      "needle",
    );
    expect(snippet).toContain("Needle");
  });
});
