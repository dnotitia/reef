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

interface TextRange {
  start: number;
  end: number;
}

function foldWithSourceRanges(value: string): {
  folded: string;
  starts: number[];
  ends: number[];
} {
  let folded = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let sourceIndex = 0;
  for (const symbol of value) {
    const foldedSymbol = symbol.toLowerCase();
    folded += foldedSymbol;
    for (let index = 0; index < foldedSymbol.length; index += 1) {
      starts.push(sourceIndex);
      ends.push(sourceIndex + symbol.length);
    }
    sourceIndex += symbol.length;
  }
  return { folded, starts, ends };
}

function findCaseInsensitiveLiteralRange(
  value: string,
  query: string,
): TextRange | null {
  const source = foldWithSourceRanges(value);
  const needle = foldWithSourceRanges(query).folded;
  if (!needle) return null;
  const foldedIndex = source.folded.indexOf(needle);
  if (foldedIndex < 0) return null;
  const start = source.starts[foldedIndex];
  const end = source.ends[foldedIndex + needle.length - 1];
  return start === undefined || end === undefined ? null : { start, end };
}

function normalizeDisplayText(
  value: string,
  preservedRange: TextRange | null,
): { text: string; matchStart: number | null } {
  const headingPrefixes = [...value.matchAll(/^\s{0,3}#{1,6}\s+/gm)].map(
    (match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }),
  );
  let text = "";
  let matchStart: number | null = null;
  let sourceIndex = 0;
  let headingIndex = 0;

  for (const symbol of value) {
    const sourceEnd = sourceIndex + symbol.length;
    while (
      headingPrefixes[headingIndex] &&
      sourceIndex >= headingPrefixes[headingIndex].end
    ) {
      headingIndex += 1;
    }
    const inPreservedRange =
      preservedRange !== null &&
      sourceIndex < preservedRange.end &&
      sourceEnd > preservedRange.start;
    const inHeadingPrefix =
      headingPrefixes[headingIndex] !== undefined &&
      sourceIndex >= headingPrefixes[headingIndex].start &&
      sourceIndex < headingPrefixes[headingIndex].end;

    if (inPreservedRange && matchStart === null) matchStart = text.length;
    if (!inHeadingPrefix || inPreservedRange) {
      if (/\s/u.test(symbol) && !inPreservedRange) {
        if (text && !/\s$/u.test(text)) text += " ";
      } else {
        text += symbol;
      }
    }
    sourceIndex = sourceEnd;
  }

  return { text: text.trimEnd(), matchStart };
}

export function buildContentSearchSnippet(
  value: string,
  query: string,
): string {
  const matchRange = findCaseInsensitiveLiteralRange(value, query);
  const normalized = normalizeDisplayText(value, matchRange);
  const { text } = normalized;
  if (text.length <= MAX_SNIPPET_LENGTH) return text;

  const center = normalized.matchStart ?? 0;
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

function mergeSearchParts(
  body: readonly IssueContentSearchResult[],
  comments: readonly IssueContentSearchResult[],
  limit: number,
): IssueContentSearchResult[] {
  const results: IssueContentSearchResult[] = [];
  let bodyIndex = 0;
  let commentIndex = 0;
  while (
    results.length < limit &&
    (bodyIndex < body.length || commentIndex < comments.length)
  ) {
    const bodyResult = body[bodyIndex];
    if (bodyResult) {
      results.push(bodyResult);
      bodyIndex += 1;
    }
    const commentResult = comments[commentIndex];
    if (results.length < limit && commentResult) {
      results.push(commentResult);
      commentIndex += 1;
    }
  }
  return results;
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
      // Ignore a malformed projection row and continue with the remaining
      // search results.
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
          `SELECT id, reef_id, body, created_at FROM (
            SELECT id, reef_id, body, meta->>'created_at' AS created_at,
              ROW_NUMBER() OVER (
                PARTITION BY reef_id
                ORDER BY meta->>'created_at' DESC, id ASC
              ) AS issue_rank
            FROM ${tableRef(REEF_COMMENTS_TABLE)}
            WHERE body ILIKE ${quoteText(
              `%${escaped}%`,
              "comment search pattern",
            )} ESCAPE '\\'
          ) AS ranked_comments
          WHERE issue_rank = 1
          ORDER BY created_at DESC, id ASC
          LIMIT ${limit}`,
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
    results: mergeSearchParts(body.results, comments.results, limit),
    has_more:
      combined.length > limit || body.mayHaveMore || comments.mayHaveMore,
  });
}
