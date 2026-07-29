import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidIssueIdResponse,
  invalidJsonBodyResponse,
  isValidIssueIdPathParam,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  type AkbAdapter,
  akbGetEffectiveSubscriptionState,
  akbMuteIssue,
  akbWatchIssue,
} from "@reef/core";
import { z } from "zod";

const SubscriptionActionSchema = z
  .object({
    action: z.enum(["watch", "mute"]),
  })
  .strict();

type RouteParams = { params: Promise<{ id: string }> };

type SubscriptionContext =
  | { adapter: AkbAdapter; actor: string; vault: string }
  | { response: Response };

async function resolveContext(
  request: Request,
  id: string,
): Promise<SubscriptionContext> {
  if (!isValidIssueIdPathParam(id)) {
    return { response: await invalidIssueIdResponse() } as const;
  }

  const vault = parseVaultParam(request);
  if (!vault) return { response: await missingVaultParamResponse() } as const;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) {
    return { response: await adapterResult.response } as const;
  }

  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) {
    return { response: actorResult.response } as const;
  }

  return {
    adapter: adapterResult.adapter,
    actor: actorResult.actor,
    vault,
  } as const;
}

/** GET /api/issues/[id]/subscription?vault={vault} → { state } */
export async function GET(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { id } = await params;
  const context = await resolveContext(request, id);
  if ("response" in context) return context.response;
  const { adapter, actor, vault } = context;

  try {
    const state = await runRouteSpan({
      name: "route.read_issue_subscription",
      attributes: { vault, issue_id: id },
      run: () =>
        akbGetEffectiveSubscriptionState(adapter, vault, {
          reefId: id,
          subscriber: actor,
        }),
    });
    return Response.json({ state });
  } catch (err) {
    logger.error(
      { err, vault, id, operation: "read" },
      "issue_subscription failed",
    );
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/** PUT /api/issues/[id]/subscription?vault={vault} { action } → { state } */
export async function PUT(
  request: Request,
  { params }: RouteParams,
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = SubscriptionActionSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const context = await resolveContext(request, id);
  if ("response" in context) return context.response;
  const { adapter, actor, vault } = context;
  const input = { reefId: id, subscriber: actor };

  try {
    const state = await runRouteSpan({
      name: "route.update_issue_subscription",
      attributes: {
        vault,
        issue_id: id,
        subscription_action: parsed.data.action,
      },
      run: async () => {
        if (parsed.data.action === "watch") {
          await akbWatchIssue(adapter, vault, input);
        } else {
          await akbMuteIssue(adapter, vault, input);
        }
        return akbGetEffectiveSubscriptionState(adapter, vault, input);
      },
    });
    return Response.json({ state });
  } catch (err) {
    logger.error(
      { err, vault, id, operation: parsed.data.action },
      "issue_subscription failed",
    );
    return respondWithError(err, { resourceKind: "issue" });
  }
}
