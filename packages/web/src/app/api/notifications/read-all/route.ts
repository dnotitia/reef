import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { PersonalNotificationReadAllRequestSchema } from "@reef/core";
import { markAllPersonalNotificationsRead } from "@/server/application/notifications/markAllPersonalNotificationsRead";

/** POST /api/notifications/read-all — read the actor's fixed personal snapshot. */
export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = PersonalNotificationReadAllRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;

  try {
    const result = await runRouteSpan({
      name: "route.mark_all_personal_notifications_read",
      run: () =>
        markAllPersonalNotificationsRead({
          adapter: adapterResult.adapter,
          actor: actorResult.actor,
          targets: parsed.data.targets,
        }),
    });
    return Response.json(
      { result },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  } catch (err) {
    logger.error({ err }, "mark_all_personal_notifications_read failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
