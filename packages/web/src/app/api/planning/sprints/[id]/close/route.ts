import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  invalidSprintIdResponse,
  requireVaultWriter,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbCloseSprintAndRollover as closeSprintAndRollover } from "@reef/core";
import { CloseSprintRequestSchema } from "../../../schemas";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return invalidSprintIdResponse();
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = CloseSprintRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  const writer = await requireVaultWriter(adapter, parsed.data.vault);
  if ("response" in writer) return writer.response;

  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;

  try {
    const result = await closeSprintAndRollover({
      adapter,
      vault: parsed.data.vault,
      sourceSprintId: id,
      target: parsed.data.target,
      endDate: parsed.data.end_date,
      actor: actorResult.actor,
      source: "user:sprint_rollover",
    });
    return Response.json(result);
  } catch (err) {
    logger.error(
      { err, vault: parsed.data.vault, sprint_id: id },
      "close_sprint_and_rollover failed",
    );
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
