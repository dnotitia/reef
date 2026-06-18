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
  CommentUpdateInputSchema,
  akbUpdateComment as updateComment,
} from "@reef/core";

/** akb assigns each comment row a uuid primary key. */
const COMMENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidCommentIdResponse(): Response {
  return Response.json({ error: "Invalid comment id." }, { status: 400 });
}

/**
 * Edit one comment (REEF-062 AC2). Ownership is enforced in core: the update
 * only matches a row whose `meta.author` equals the session actor, so a
 * non-author edit surfaces as a 404. `vault` is a query param.
 *
 * PATCH /api/issues/[id]/comments/[commentId]?vault={vault} — body { body }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  const { id, commentId } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();
  if (!COMMENT_ID_RE.test(commentId)) return invalidCommentIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = CommentUpdateInputSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const comment = await runRouteSpan({
      name: "route.update_comment",
      attributes: { vault, issue_id: id, comment_id: commentId },
      run: () =>
        updateComment(adapter, vault, commentId, parsed.data.body, actor),
    });
    return Response.json({ comment });
  } catch (err) {
    logger.error({ err, vault, id, commentId }, "update_comment failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
