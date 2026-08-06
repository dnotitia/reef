import { tool } from "ai";
import { listIssues } from "../../../adapters/akb";
import type { AkbAdapter } from "../../../adapters/akb";
import {
  quoteText,
  rowToIssue,
  searchDocuments,
  selectIssueRows,
} from "../../../adapters/akb/core/shared";
import { SchemaValidationError } from "../../../errors";
import {
  SearchIssuesInputSchema,
  type SearchIssuesOutput,
  SearchIssuesOutputSchema,
  type SearchIssuesResult,
} from "../../../schemas/ai/tools";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import { withToolSpan } from "../withToolSpan";

/**
 * search_issues — Search vault issues with akb hybrid retrieval when a query is
 * provided, then apply Reef metadata filters. Empty-query calls keep the
 * metadata-list fallback so the chat agent can still ask for "all open bugs"
 * without inventing a semantic query.
 *
 * To avoid hammering akb for empty-query calls, `listIssues` is memoised in the
 * factory closure. Hybrid queries are not cached because the query string and
 * result ordering are materially part of the answer.
 */
export function createSearchIssuesTool({
  adapter,
  vault,
}: {
  adapter: AkbAdapter;
  vault: string;
}) {
  let cachedListPromise: Promise<readonly IssueMetadata[]> | null = null;
  function loadAllIssues(): Promise<readonly IssueMetadata[]> {
    if (cachedListPromise) return cachedListPromise;
    cachedListPromise = listIssues({ adapter, vault })
      .then((result) => result.issues)
      .catch((err) => {
        cachedListPromise = null;
        throw err;
      });
    return cachedListPromise;
  }

  return tool({
    description:
      "Search existing Reef issues. Non-empty queries use akb hybrid semantic " +
      "search over issue documents, then apply status, assigned_to, and labels " +
      "filters. Returns metadata plus matched_section/score, but no body.",
    inputSchema: SearchIssuesInputSchema,
    execute: async (input): Promise<SearchIssuesOutput> => {
      return withToolSpan(
        "reef.tool.search_issues",
        input,
        (span, i) => {
          span.setAttribute("tool.input.query", i.query);
          if (i.status)
            span.setAttribute("tool.input.status", i.status.join(","));
          if (i.assigned_to)
            span.setAttribute("tool.input.assigned_to", i.assigned_to);
        },
        async (span) => {
          const issues =
            input.query.trim().length === 0
              ? filterIssues(await loadAllIssues(), input).slice(0, input.limit)
              : await hybridSearchIssues({
                  adapter,
                  vault,
                  query: input.query,
                  limit: input.limit,
                  input,
                });

          const parsed = SearchIssuesOutputSchema.safeParse({ issues });
          if (!parsed.success) {
            throw new SchemaValidationError({
              field: "searchIssuesOutput",
              issues: parsed.error.issues.map((i) => i.message),
            });
          }
          span.setAttribute("tool.output.issue_count", issues.length);
          return parsed.data;
        },
      );
    },
  });
}

async function hybridSearchIssues({
  adapter,
  vault,
  query,
  limit,
  input,
}: {
  adapter: AkbAdapter;
  vault: string;
  query: string;
  limit: number;
  input: {
    status: ReadonlyArray<IssueMetadata["status"]> | null;
    assigned_to: string | null;
    labels: readonly string[] | null;
  };
}): Promise<SearchIssuesResult[]> {
  const hits = await searchDocuments({
    adapter,
    vault,
    collection: "issues",
    type: "task",
    query,
    limit,
  });
  const uris = [...new Set(hits.map((hit) => hit.uri))];
  if (uris.length === 0) return [];

  const rows = await selectIssueRows(
    adapter,
    vault,
    `document_uri IN (${uris
      .map((uri) => quoteText(uri, "document_uri"))
      .join(", ")})`,
  );
  const byUri = new Map(
    rows
      .map((row) => {
        const uri = row.document_uri;
        return typeof uri === "string"
          ? ([uri, rowToIssue(row)] as const)
          : null;
      })
      .filter(
        (entry): entry is readonly [string, IssueMetadata] => entry !== null,
      ),
  );

  const results: SearchIssuesResult[] = [];
  for (const hit of hits) {
    const issue = byUri.get(hit.uri);
    if (!issue) continue;
    if (!matchesMetadataFilters(issue, input)) continue;
    results.push({
      ...issue,
      matched_section: hit.matched_section ?? null,
      score: hit.score ?? null,
    });
    if (results.length >= limit) break;
  }
  return results;
}

function filterIssues(
  all: readonly IssueMetadata[],
  input: {
    query: string;
    status: ReadonlyArray<IssueMetadata["status"]> | null;
    assigned_to: string | null;
    labels: readonly string[] | null;
  },
): IssueMetadata[] {
  const q = input.query.trim().toLowerCase();

  return all.filter((issue) => {
    if (q.length > 0 && !issue.title.toLowerCase().includes(q)) return false;
    return matchesMetadataFilters(issue, input);
  });
}

function matchesMetadataFilters(
  issue: IssueMetadata,
  input: {
    status: ReadonlyArray<IssueMetadata["status"]> | null;
    assigned_to: string | null;
    labels: readonly string[] | null;
  },
): boolean {
  const statusSet =
    input.status && input.status.length > 0 ? new Set(input.status) : null;
  const assignedTo = input.assigned_to?.trim() ?? null;
  const requiredLabels =
    input.labels && input.labels.length > 0 ? input.labels : null;

  if (statusSet && !statusSet.has(issue.status)) return false;
  if (assignedTo) {
    if (!issue.assigned_to) return false;
    if (issue.assigned_to !== assignedTo) return false;
  }
  if (requiredLabels) {
    const labels = issue.labels ?? [];
    for (const required of requiredLabels) {
      if (!labels.includes(required)) return false;
    }
  }
  return true;
}
