import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  ConflictError,
  UpdateSavedIssueViewSchema,
  akbDeleteSavedIssueView,
  akbUpdateSavedIssueView,
} from "@reef/core";
import { z } from "zod";

const IdSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return localizedErrorResponse("invalidSavedViewId", 400);
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = UpdateSavedIssueViewSchema.safeParse(raw);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  try {
    return Response.json(
      await akbUpdateSavedIssueView({
        adapter: adapterResult.adapter,
        vault,
        id,
        patch: parsed.data,
      }),
    );
  } catch (error) {
    if (error instanceof ConflictError) {
      return localizedErrorResponse("savedViewDuplicate", 409);
    }
    logger.error({ err: error, vault, id }, "update_saved_view failed");
    return respondWithError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return localizedErrorResponse("invalidSavedViewId", 400);
  }
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  try {
    await akbDeleteSavedIssueView({
      adapter: adapterResult.adapter,
      vault,
      id,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    logger.error({ err: error, vault, id }, "delete_saved_view failed");
    return respondWithError(error);
  }
}
