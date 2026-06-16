import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  BacklogReorderRequestSchema,
  akbReorderBacklogIssues,
} from "@reef/core";

/**
 * POST /api/issues/reorder
 *
 * Persist a backlog drag-reorder's `rank` writes (REEF-129) as ONE atomic
 * server update, so a multi-row reorder (tail materialization, curated
 * re-space) does not lands partially the way independent per-row PATCHes could.
 * Row — `rank` is not a document field — so no commit churns.
 * Last-write-wins, like every reef row edit.
 */
export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = BacklogReorderRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const { vault, assignments } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  // Resolve the actor server-side so the reorder's `updated_at` bump carries a
  // matching `meta.last_editor`; does not trust a client-supplied actor.
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    await runRouteSpan({
      name: "route.reorder_backlog",
      attributes: { vault, count: assignments.length },
      run: () =>
        akbReorderBacklogIssues({ adapter, vault, assignments, actor }),
    });
    return Response.json({ ok: true });
  } catch (err) {
    logger.error({ err, vault }, "reorder_backlog failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
