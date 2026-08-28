import {
  type SimilarIssue,
  SimilarIssueSchema,
} from "../../../schemas/issues/metadata";
import { searchDocuments } from "../core/documents";
import type { AkbAdapter } from "../core/http";
import { assertNoNul } from "../core/sql";
import { withSpan } from "../core/tracing";
import { hydrateIssuesByDocumentUri } from "./issueRows";

const DEFAULT_SIMILAR_ISSUE_LIMIT = 5;
export const DEFAULT_SIMILAR_ISSUE_MIN_SCORE = 0.03;
const SEARCH_PREFETCH_LIMIT = 20;

export interface SearchSimilarIssuesParams {
  adapter: AkbAdapter;
  vault: string;
  title: string;
  limit?: number;
  minScore?: number;
}

export async function searchSimilarIssues({
  adapter,
  vault,
  title,
  limit = DEFAULT_SIMILAR_ISSUE_LIMIT,
  minScore = DEFAULT_SIMILAR_ISSUE_MIN_SCORE,
}: SearchSimilarIssuesParams): Promise<SimilarIssue[]> {
  const query = title.trim();
  assertNoNul(query, "search query");
  if (query.length < 3) return [];

  const resultLimit = Math.max(1, Math.min(limit, DEFAULT_SIMILAR_ISSUE_LIMIT));
  const fetchLimit = Math.max(SEARCH_PREFETCH_LIMIT, resultLimit);

  return withSpan(
    "akb.search_similar_issues",
    { vault, limit: resultLimit, min_score: minScore },
    async (span) => {
      const hits = await searchDocuments({
        adapter,
        vault,
        collection: "issues",
        type: "task",
        query,
        limit: fetchLimit,
      });
      const eligibleHits = hits.filter(
        (hit) => typeof hit.score === "number" && hit.score >= minScore,
      );
      const byUri = await hydrateIssuesByDocumentUri(
        adapter,
        vault,
        eligibleHits.map((hit) => hit.uri),
      );

      const issues: SimilarIssue[] = [];
      const seenIds = new Set<string>();
      for (const hit of eligibleHits) {
        const issue = byUri.get(hit.uri);
        if (!issue || seenIds.has(issue.id) || typeof hit.score !== "number") {
          continue;
        }
        seenIds.add(issue.id);
        issues.push(
          SimilarIssueSchema.parse({
            ...issue,
            matched_section: hit.matched_section ?? null,
            score: hit.score,
          }),
        );
        if (issues.length >= resultLimit) break;
      }

      span.setAttribute("candidate_count", eligibleHits.length);
      span.setAttribute("issue_count", issues.length);
      return issues;
    },
  );
}
