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
  akbDeleteRelease as deleteRelease,
  akbUpdateRelease as updateRelease,
} from "@reef/core";
import { UpdateReleaseRequestSchema } from "../../schemas";

function invalidPlanningIdResponse(): Promise<Response> {
  return localizedErrorResponse("invalidReleaseId", 400);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return invalidPlanningIdResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = UpdateReleaseRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, item } = parsed.data;
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const release = await updateRelease({ adapter, vault, id, item });
    return Response.json({ item: release });
  } catch (err) {
    logger.error({ err, vault, id }, "update_release failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return invalidPlanningIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await deleteRelease({ adapter, vault, id });
    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error({ err, vault, id }, "delete_release failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
