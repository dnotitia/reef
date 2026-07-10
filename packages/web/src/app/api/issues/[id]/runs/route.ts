import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidIssueIdResponse,
  invalidJsonBodyResponse,
  isValidIssueIdPathParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { getDevelopmentProfileCatalog } from "@/lib/server/developmentProfiles";
import {
  IssueRunRequestBodySchema,
  IssueRunRequestResultSchema,
  akbRequestQueuedIssueRun as requestQueuedIssueRun,
} from "@reef/core";
import { issueRunErrorResponse } from "../issueRunRouteHelpers";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = IssueRunRequestBodySchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const [actorResult, catalog] = await Promise.all([
    getAkbCurrentActor(request),
    getDevelopmentProfileCatalog(),
  ]);
  if ("response" in actorResult) return actorResult.response;
  const { vault, github_id: githubId, request_id: requestId } = parsed.data;

  try {
    const result = await runRouteSpan({
      name: "route.request_issue_run",
      attributes: { vault, issue_id: id, github_id: githubId },
      run: () =>
        requestQueuedIssueRun({
          adapter: adapterResult.adapter,
          vault,
          id,
          actor: actorResult.actor,
          catalog,
          githubId,
          requestId,
        }),
    });
    if (result.kind === "rejected") {
      return issueRunErrorResponse(result.reason);
    }
    if (result.kind === "conflict") {
      return issueRunErrorResponse("run_already_active", {
        runId: result.run_id,
      });
    }
    const body = IssueRunRequestResultSchema.parse({
      run_id: result.run_id,
      status: result.status,
      created: result.created,
    });
    return Response.json(body, {
      status: result.kind === "created" ? 202 : 200,
    });
  } catch (err) {
    logger.error(
      { err, vault, id, github_id: githubId },
      "request_issue_run failed",
    );
    return respondWithError(err, { resourceKind: "issue" });
  }
}
