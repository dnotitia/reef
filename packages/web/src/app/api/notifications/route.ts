import {
  getAkbAdapter,
  getAkbCurrentActor,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { listPersonalNotifications } from "@/server/application/notifications/listPersonalNotifications";

/** GET /api/notifications — the authenticated actor's personal Inbox. */
export async function GET(request: Request): Promise<Response> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;

  try {
    const notifications = await runRouteSpan({
      name: "route.list_personal_notifications",
      run: () =>
        listPersonalNotifications({
          adapter: adapterResult.adapter,
          actor: actorResult.actor,
        }),
    });
    return Response.json(
      { notifications },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  } catch (err) {
    logger.error({ err }, "list_personal_notifications failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
