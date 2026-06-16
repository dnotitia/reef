import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbCreateSprint as createSprint } from "@reef/core";
import { CreateSprintRequestSchema } from "../schemas";

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = CreateSprintRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, item } = parsed.data;
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const sprint = await createSprint({ adapter, vault, item });
    return Response.json({ item: sprint }, { status: 201 });
  } catch (err) {
    logger.error({ err, vault }, "create_sprint failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
