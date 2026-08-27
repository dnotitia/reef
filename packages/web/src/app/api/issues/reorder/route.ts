import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import { IssueReorderRequestSchema, akbReorderIssue } from "@reef/core";

/**
 * POST /api/issues/reorder
 *
 * Persist a Manual-order move from Board, List, or Backlog. The adapter reads
 * canonical neighbours and applies rank plus an optional single-value group
 * change atomically; the browser page is never treated as the full ordering.
 */
export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = IssueReorderRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const { vault, scope, issue_id, before_id, after_id, expected, group } =
    parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  // Resolve the actor server-side so the reorder's `updated_at` bump carries a
  // matching `meta.last_editor`; does not trust a client-supplied actor.
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const result = await runRouteSpan({
      name: "route.reorder_issue",
      attributes: { vault, scope, issue_id },
      run: () =>
        akbReorderIssue({
          adapter,
          vault,
          scope,
          issueId: issue_id,
          beforeId: before_id,
          afterId: after_id,
          expected: {
            issueRank: expected.issue_rank,
            issueUpdatedAt: expected.issue_updated_at,
            beforeRank: expected.before_rank,
            beforeUpdatedAt: expected.before_updated_at,
            afterRank: expected.after_rank,
            afterUpdatedAt: expected.after_updated_at,
          },
          group,
          actor,
          at: new Date().toISOString(),
        }),
    });
    return Response.json({
      ok: true,
      assignments: result.assignments.map(({ id, rank, updatedAt }) => ({
        id,
        rank,
        ...(updatedAt ? { updated_at: updatedAt } : {}),
      })),
    });
  } catch (err) {
    logger.error({ err, vault, scope, issue_id }, "reorder_issue failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
