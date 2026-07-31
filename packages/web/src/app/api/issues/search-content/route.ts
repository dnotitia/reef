import {
  getAkbAdapter,
  invalidBodyResponse,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  IssueContentSearchRequestSchema,
  IssueContentSearchResponseSchema,
  akbSearchIssueContent as searchIssueContent,
} from "@reef/core";

/**
 * GET /api/issues/search-content?vault={vault}&q={query}&limit={10..50}
 *
 * Thin authenticated boundary for body/comment search. Query text is validated
 * here but deliberately omitted from logs and span attributes.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const { searchParams } = new URL(request.url);
  const parsed = IssueContentSearchRequestSchema.safeParse({
    q: searchParams.get("q") ?? "",
    limit: Number(searchParams.get("limit")),
  });
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const { q, limit } = parsed.data;

  try {
    const result = await runRouteSpan({
      name: "route.search_issue_content",
      attributes: { vault, limit },
      run: () =>
        searchIssueContent({
          adapter,
          vault,
          query: q,
          limit,
        }),
    });
    return Response.json(IssueContentSearchResponseSchema.parse(result));
  } catch (error) {
    logger.error({ err: error, vault, limit }, "search_issue_content failed");
    return respondWithError(error, { resourceKind: "workspace" });
  }
}
