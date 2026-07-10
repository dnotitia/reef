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
  CommentCreateInputSchema,
  NotFoundError,
  akbCreateComment as createComment,
  akbListComments as listComments,
} from "@reef/core";

/**
 * Flat issue comments (REEF-062). `vault` is a query param; the comment author
 * is the session actor resolved server-side (not client-supplied). The reef
 * id is the `[id]` path segment.
 */

/** GET /api/issues/[id]/comments?vault={vault} → { comments } */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const comments = await runRouteSpan({
      name: "route.list_comments",
      attributes: { vault, issue_id: id },
      run: () => listComments(adapter, vault, id),
    });
    return Response.json({ comments });
  } catch (err) {
    logger.error({ err, vault, id }, "list_comments failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/** POST /api/issues/[id]/comments?vault={vault} — body { body } → { comment } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = CommentCreateInputSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const comment = await runRouteSpan({
      name: "route.create_comment",
      attributes: { vault, issue_id: id },
      run: () =>
        createComment(
          adapter,
          vault,
          id,
          parsed.data.body,
          actor,
          parsed.data.parent_comment_id,
        ),
    });
    return Response.json({ comment }, { status: 201 });
  } catch (err) {
    logger.error({ err, vault, id }, "create_comment failed");
    return respondWithError(err, {
      resourceKind:
        err instanceof NotFoundError &&
        err.context.resourceKind === "commentParent"
          ? "commentParent"
          : "issue",
    });
  }
}
