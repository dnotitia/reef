import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidIssueIdResponse,
  isValidIssueIdPathParam,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { getDevelopmentProfileCatalog } from "@/lib/server/developmentProfiles";
import {
  IssueRunRequestEligibilitySchema,
  akbGetIssueRunRequestEligibility as getIssueRunRequestEligibility,
} from "@reef/core";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;

  const [actorResult, catalog] = await Promise.all([
    getAkbCurrentActor(request),
    getDevelopmentProfileCatalog(),
  ]);
  if ("response" in actorResult) return actorResult.response;

  try {
    const eligibility = await runRouteSpan({
      name: "route.issue_run_eligibility",
      attributes: { vault, issue_id: id },
      run: () =>
        getIssueRunRequestEligibility({
          adapter: adapterResult.adapter,
          vault,
          id,
          actor: actorResult.actor,
          catalog,
        }),
    });
    return Response.json(IssueRunRequestEligibilitySchema.parse(eligibility));
  } catch (err) {
    logger.error({ err, vault, id }, "issue_run_eligibility failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
