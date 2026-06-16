import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbCreateMilestone as createMilestone } from "@reef/core";
import { CreateMilestoneRequestSchema } from "../schemas";

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = CreateMilestoneRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, item } = parsed.data;
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const milestone = await createMilestone({ adapter, vault, item });
    return Response.json({ item: milestone }, { status: 201 });
  } catch (err) {
    logger.error({ err, vault }, "create_milestone failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
