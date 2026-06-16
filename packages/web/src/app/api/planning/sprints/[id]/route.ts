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
  akbDeleteSprint as deleteSprint,
  akbUpdateSprint as updateSprint,
} from "@reef/core";
import { UpdateSprintRequestSchema } from "../../schemas";

function invalidPlanningIdResponse(): Response {
  return Response.json({ error: "Invalid sprint id." }, { status: 400 });
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

  const parsed = UpdateSprintRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, item } = parsed.data;
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const sprint = await updateSprint({ adapter, vault, id, item });
    return Response.json({ item: sprint });
  } catch (err) {
    logger.error({ err, vault, id }, "update_sprint failed");
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
    await deleteSprint({ adapter, vault, id });
    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error({ err, vault, id }, "delete_sprint failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
