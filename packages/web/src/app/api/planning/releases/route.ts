import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { akbCreateRelease as createRelease } from "@reef/core";
import { CreateReleaseRequestSchema } from "../schemas";

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = CreateReleaseRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, item } = parsed.data;
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const release = await createRelease({ adapter, vault, item });
    return Response.json({ item: release }, { status: 201 });
  } catch (err) {
    logger.error({ err, vault }, "create_release failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
