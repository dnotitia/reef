import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  NotificationListInputSchema,
  NotificationStateSchema,
  akbEnsureReefTables,
  akbListNotifications,
} from "@reef/core";

const MAX_NOTIFICATION_LIST = 100;

function parseNotificationLimit(value: string | null): number {
  if (value === null) return MAX_NOTIFICATION_LIST;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : 0;
}

/**
 * GET /api/notifications?vault={vault_name}&state={state}&limit={limit}
 *
 * Core resolves the recipient from the authenticated akb actor. The query
 * omits a recipient parameter: notification visibility is an account boundary
 * rather than a client-selectable filter.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const { searchParams } = new URL(request.url);
  const stateParam = searchParams.get("state");
  const stateResult = stateParam
    ? NotificationStateSchema.safeParse(stateParam)
    : undefined;
  if (stateParam && (!stateResult || !stateResult.success)) {
    return localizedErrorResponse("invalidNotificationState", 400);
  }

  const limit = parseNotificationLimit(searchParams.get("limit"));
  if (limit === 0) {
    return localizedErrorResponse("invalidNotificationLimit", 400);
  }

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const inputResult = NotificationListInputSchema.safeParse({
    recipient: actor,
    ...(stateResult?.success ? { state: stateResult.data } : {}),
    limit,
  });
  if (!inputResult.success) return invalidBodyResponse(inputResult.error);

  try {
    const notifications = await runRouteSpan({
      name: "route.list_notifications",
      attributes: {
        vault,
        state: stateResult?.success ? stateResult.data : undefined,
        limit,
      },
      run: async () => {
        await akbEnsureReefTables({ adapter, vault });
        return akbListNotifications(adapter, vault, inputResult.data);
      },
    });
    return Response.json({ notifications }, { status: 200 });
  } catch (err) {
    logger.error({ err, vault }, "list_notifications failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
