import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { listMyWork } from "@/server/application/myWork/listMyWork";
import { MyWorkQuerySchema, MyWorkResponseSchema } from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;

  const search = new URL(request.url).searchParams;
  const rawLimit = search.get("limit");
  const rawOffset = search.get("offset");
  const query = MyWorkQuerySchema.safeParse({
    ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
    ...(rawOffset === null ? {} : { offset: Number(rawOffset) }),
  });
  if (!query.success) return invalidBodyResponse(query.error);

  try {
    const data = await listMyWork({
      adapter: adapterResult.adapter,
      actor: actorResult.actor,
      query: query.data,
    });
    return Response.json(MyWorkResponseSchema.parse(data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    logger.error({ err }, "list_my_work failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
