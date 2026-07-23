import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  ConflictError,
  CreateSavedIssueViewSchema,
  akbCreateSavedIssueView,
  akbListSavedIssueViews,
} from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  try {
    const views = await akbListSavedIssueViews({
      adapter: adapterResult.adapter,
      vault,
    });
    return Response.json({ views });
  } catch (error) {
    logger.error({ err: error, vault }, "list_saved_views failed");
    return respondWithError(error, { resourceKind: "workspace" });
  }
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = CreateSavedIssueViewSchema.safeParse(raw);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  try {
    const result = await akbCreateSavedIssueView({
      adapter: adapterResult.adapter,
      vault,
      owner: actorResult.actor,
      view: parsed.data,
    });
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ConflictError) {
      return localizedErrorResponse("savedViewDuplicate", 409);
    }
    logger.error({ err: error, vault }, "create_saved_view failed");
    return respondWithError(error, { resourceKind: "workspace" });
  }
}
