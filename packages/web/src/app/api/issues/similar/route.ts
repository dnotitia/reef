import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  SimilarIssueSchema,
  akbSearchSimilarIssues as searchSimilarIssues,
} from "@reef/core";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;
const MIN_QUERY_LENGTH = 3;

/**
 * GET /api/issues/similar?vault={vault}&q={title}&limit=5
 *
 * Best-effort duplicate hinting for issue creation/review. Non-empty searches
 * delegate to core's akb issue search path, which uses akb semantic retrieval
 * over the current vault's issue documents. No LLM call is involved.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return Response.json({ issues: [] });
  }

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const issues = await runRouteSpan({
      name: "route.search_similar_issues",
      attributes: { vault, limit },
      run: async () => {
        const result = await searchSimilarIssues({
          adapter,
          vault,
          title: query,
          limit,
        });
        return result.map((issue) => SimilarIssueSchema.parse(issue));
      },
    });
    return Response.json({ issues });
  } catch (err) {
    logger.error({ err, vault }, "search_similar_issues failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
