import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  VaultNameSchema,
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  NotificationStateSchema,
  akbEnsureReefTables,
  akbUpdateNotificationState,
} from "@reef/core";
import { z } from "zod";

const NotificationStateMutationRequestSchema = z.object({
  vault: VaultNameSchema,
  state: NotificationStateSchema,
});

/**
 * PATCH /api/notifications/{notification_key}
 *
 * The request contains only the workspace and desired state. Core receives the
 * current actor as `recipient`, so a copied key cannot update another user's
 * notification even if the caller adds a forged recipient to the request. Any
 * legacy recipient field is intentionally ignored at this boundary.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
): Promise<Response> {
  const { key: rawKey } = await params;
  let notificationKey: string;
  try {
    notificationKey = decodeURIComponent(rawKey);
  } catch {
    return localizedErrorResponse("invalidNotificationKey", 400);
  }
  if (!notificationKey.trim()) {
    return localizedErrorResponse("invalidNotificationKey", 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = NotificationStateMutationRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const { vault, state } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const notification = await runRouteSpan({
      name: "route.update_notification_state",
      attributes: { vault, state },
      run: async () => {
        await akbEnsureReefTables({ adapter, vault });
        return akbUpdateNotificationState(adapter, vault, {
          notificationKey,
          recipient: actor,
          state,
        });
      },
    });
    return Response.json({ notification }, { status: 200 });
  } catch (err) {
    logger.error({ err, vault }, "update_notification_state failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
