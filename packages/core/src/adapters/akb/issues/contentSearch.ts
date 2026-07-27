import type {
  IssueContentSearchResponse,
  IssueContentSearchResult,
} from "../../../schemas/issues/contentSearch";
import { IssueContentSearchResponseSchema } from "../../../schemas/issues/contentSearch";
import { REEF_COMMENTS_TABLE } from "../core/constants";
import { searchDocumentsWithMetadata } from "../core/documents";
import type { AkbAdapter, AkbSearchHit } from "../core/http";
import { isMissingTableError, quoteText, runSql, tableRef } from "../core/sql";
import { withSpan } from "../core/tracing";
import { rowToIssue, selectIssueRows } from "./issueRows";

const MAX_SNIPPET_LENGTH = 280;
const SNIPPET_CONTEXT = 90;

function normalizeDisplayText(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function buildContentSearchSnippet(
  value: string,
  query: string,
): string {
  const text = normalizeDisplayText(value);
  if (text.length <= MAX_SNIPPET_LENGTH) return text;

  const matchIndex = text
    .toLocaleLowerCase()
    .indexOf(query.toLocaleLowerCase());
  const center = matchIndex >= 0 ? matchIndex : 0;
  const start = Math.max(0, center - SNIPPET_CONTEXT);
  const end = Math.min(text.length, start + MAX_SNIPPET_LENGTH);
  const slice = text.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${slice}${end < text.length ? "…" : ""}`;
}

function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

interface SearchPart {
  results: IssueContentSearchResult[];
  mayHaveMore: boolean;
}

async function hydrateIssuesByDocumentUri(
  adapter: AkbAdapter,
  vault: string,
  hits: readonly AkbSearchHit[],
): Promise<Map<string, ReturnType<typeof rowToIssue>>> {
  const uris = [...new Set(hits.map((hit) => hit.uri))];
  if (uris.length === 0) return new Map();
  const rows = await selectIssueRows(
    adapter,
    vault,
    `document_uri IN (${uris
      .map((uri) => quoteText(uri, "document_uri"))
      .join(", ")})`,
  );
  const issues = new Map<string, ReturnType<typeof rowToIssue>>();
  for (const row of rows) {
    const uri = row.document_uri;
    if (typeof uri !== "string") continue;
    try {
      const issue = rowToIssue(row);
      if (issue.archived_at == null) issues.set(uri, issue);
    } catch {
      // A malformed projection row must not fail the remaining search results.
    }
  }
  return issues;
}

async function searchBodyMatches(
  adapter: AkbAdapter,
  vault: string,
  query: string,
  limit: number,
): Promise<SearchPart> {
  return withSpan(
    "akb.search_issue_content_body",
    { vault, limit },
    async (span) => {
      const search = await searchDocumentsWithMetadata({
        adapter,
        vault,
        collection: "issues",
        type: "task",
        query,
        limit,
        requireHealthy: true,
      });
      const issuesByUri = await hydrateIssuesByDocumentUri(
        adapter,
        vault,
        search.hits,
      );
      const results: IssueContentSearchResult[] = [];
      const seenIssues = new Set<string>();
      for (const hit of search.hits) {
        const issue = issuesByUri.get(hit.uri);
        const matchedText = hit.matched_section ?? "";
        if (!issue || seenIssues.has(issue.id) || !matchedText.trim()) continue;
        const snippet = buildContentSearchSnippet(matchedText, query);
        if (!snippet) continue;
        seenIssues.add(issue.id);
        results.push({
          reef_id: issue.id,
          title: issue.title,
          snippet,
          source: "body",
          score: typeof hit.score === "number" ? hit.score : null,
          match_id: `body:${hit.uri}`,
        });
      }
      span.setAttribute("candidate_count", search.hits.length);
      span.setAttribute("result_count", results.length);
      return {
        results,
        mayHaveMore: search.truncated || search.returned >= limit,
      };
    },
  );
}

async function searchCommentMatches(
  adapter: AkbAdapter,
  vault: string,
  query: string,
  limit: number,
): Promise<SearchPart> {
  return withSpan(
    "akb.search_issue_content_comments",
    { vault, limit },
    async (span) => {
      const escaped = escapeLikeLiteral(query);
      let rows: Record<string, unknown>[];
      try {
        const response = await runSql(
          adapter,
          vault,
          `SELECT id, reef_id, body, meta->>'created_at' AS created_at FROM ${tableRef(
            REEF_COMMENTS_TABLE,
          )} WHERE body ILIKE ${quoteText(
            `%${escaped}%`,
            "comment search pattern",
          )} ESCAPE '\\' ORDER BY meta->>'created_at' DESC, id ASC LIMIT ${limit}`,
        );
        rows = response.kind === "table_query" ? response.items : [];
      } catch (error) {
        if (isMissingTableError(error)) {
          span.setAttribute("table_exists", false);
          return { results: [], mayHaveMore: false };
        }
        throw error;
      }

      const reefIds = [
        ...new Set(
          rows.flatMap((row) =>
            typeof row.reef_id === "string" ? [row.reef_id] : [],
          ),
        ),
      ];
      const issueRows =
        reefIds.length === 0
          ? []
          : await selectIssueRows(
              adapter,
              vault,
              `reef_id IN (${reefIds
                .map((id) => quoteText(id, "reef_id"))
                .join(", ")})`,
            );
      const issuesById = new Map<string, ReturnType<typeof rowToIssue>>();
      for (const row of issueRows) {
        try {
          const issue = rowToIssue(row);
          if (issue.archived_at == null) issuesById.set(issue.id, issue);
        } catch {
          // Skip malformed or stale issue projections independently.
        }
      }

      const results: IssueContentSearchResult[] = [];
      const seenIssues = new Set<string>();
      for (const row of rows) {
        if (
          typeof row.id !== "string" ||
          typeof row.reef_id !== "string" ||
          typeof row.body !== "string"
        ) {
          continue;
        }
        const issue = issuesById.get(row.reef_id);
        if (!issue || seenIssues.has(issue.id)) continue;
        const snippet = buildContentSearchSnippet(row.body, query);
        if (!snippet) continue;
        seenIssues.add(issue.id);
        results.push({
          reef_id: issue.id,
          title: issue.title,
          snippet,
          source: "comment",
          score: null,
          match_id: `comment:${row.id}`,
        });
      }
      span.setAttribute("candidate_count", rows.length);
      span.setAttribute("result_count", results.length);
      return { results, mayHaveMore: rows.length >= limit };
    },
  );
}

export async function searchIssueContent({
  adapter,
  vault,
  query,
  limit,
}: {
  adapter: AkbAdapter;
  vault: string;
  query: string;
  limit: number;
}): Promise<IssueContentSearchResponse> {
  const [body, comments] = await Promise.all([
    searchBodyMatches(adapter, vault, query, limit),
    searchCommentMatches(adapter, vault, query, limit),
  ]);
  const combined = [...body.results, ...comments.results];
  return IssueContentSearchResponseSchema.parse({
    results: combined.slice(0, limit),
    has_more:
      combined.length > limit || body.mayHaveMore || comments.mayHaveMore,
  });
}
