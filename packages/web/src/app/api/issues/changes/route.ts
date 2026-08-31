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
  IssueChangeReviewRangeSchema,
  akbListIssueChangeReview as listIssueChangeReview,
} from "@reef/core";

function readRange(request: Request): Record<string, unknown> {
  const search = new URL(request.url).searchParams;
  return {
    start_at: search.get("start_at"),
    end_at: search.get("end_at"),
  };
}

/** GET /api/issues/changes?vault=…&start_at=…&end_at=… */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const parsedRange = IssueChangeReviewRangeSchema.safeParse(
    readRange(request),
  );
  if (!parsedRange.success) return invalidBodyResponse(parsedRange.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const review = await runRouteSpan({
      name: "route.list_issue_change_review",
      attributes: { vault },
      run: () =>
        listIssueChangeReview({
          adapter,
          vault,
          range: parsedRange.data,
        }),
    });
    return Response.json(review);
  } catch (err) {
    logger.error({ err, vault }, "list_issue_change_review failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
