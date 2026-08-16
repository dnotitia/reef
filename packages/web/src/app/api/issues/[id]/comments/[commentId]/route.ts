import { localizedErrorResponse } from "@/lib/api/errorLocalization";
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
  akbDeleteComment as deleteComment,
  CommentUpdateInputSchema,
  akbUpdateComment as updateComment,
} from "@reef/core";

/** akb assigns each comment row a uuid primary key. */
const COMMENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidCommentIdResponse(): Promise<Response> {
  return localizedErrorResponse("invalidCommentId", 400);
}

/**
 * Edit one comment (REEF-062 AC2). Ownership is enforced in core: the update
 * matches a row whose `meta.author` equals the session actor, so a
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
        updateComment(adapter, vault, id, commentId, parsed.data.body, actor),
    });
    return Response.json({ comment });
  } catch (err) {
    logger.error({ err, vault, id, commentId }, "update_comment failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/**
 * Permanently delete one authored comment and its reply descendants. Core
 * performs the ownership check and the comment/notification cascade in one
 * SQL statement; this route owns request validation and actor custody.
 *
 * DELETE /api/issues/[id]/comments/[commentId]?vault={vault}
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  const { id, commentId } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();
  if (!COMMENT_ID_RE.test(commentId)) return invalidCommentIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const deletion = await runRouteSpan({
      name: "route.delete_comment",
      attributes: { vault, issue_id: id, comment_id: commentId },
      run: () => deleteComment(adapter, vault, id, commentId, actor),
    });
    return Response.json(deletion);
  } catch (err) {
    logger.error({ err, vault, id, commentId }, "delete_comment failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
