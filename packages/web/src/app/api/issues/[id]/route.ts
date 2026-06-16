import {
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidIssueIdResponse,
  invalidJsonBodyResponse,
  isValidIssueIdPathParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  buildIssueUpdateMetadataPatch,
  akbDeleteIssue as deleteIssue,
  akbReadIssue as readIssue,
  akbUpdateIssue as updateIssue,
} from "@reef/core";
import { getIssueRouteReadContext } from "./routeContext";
import { UpdateIssueRequestSchema } from "./schemas";

/**
 * GET /api/issues/[id]?vault={vault_name} → { issue, content }
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const context = getIssueRouteReadContext(request, id);
  if ("response" in context) return context.response;
  const { adapter, vault } = context;

  try {
    const result = await runRouteSpan({
      name: "route.read_issue",
      attributes: { vault, issue_id: id },
      run: () => readIssue({ adapter, vault, id }),
    });

    return Response.json({ issue: result.issue, content: result.content });
  } catch (err) {
    logger.error({ err, vault, id }, "read_issue failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/**
 * PATCH /api/issues/[id]
 *
 * Last-write-wins; akb merges per-field on the document body so concurrent
 * metadata edits coexist. A `null` value in the patch is the
 * "clear this field" sentinel (used by the unarchive flow on `archived_at`)
 * — `akbUpdateIssue` drops keys with explicit null.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!isValidIssueIdPathParam(id)) return invalidIssueIdResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = UpdateIssueRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const { vault, update } = parsed.data;
  if (update.issue_id !== id) return invalidIssueIdResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const result = await runRouteSpan({
      name: "route.update_issue",
      attributes: { vault, issue_id: id },
      run: async () => {
        const partialWithTimestamp = buildIssueUpdateMetadataPatch({
          update,
          actor,
        });
        return updateIssue({
          adapter,
          vault,
          id,
          partial: partialWithTimestamp,
          ...(update.content !== undefined ? { content: update.content } : {}),
          message: `feat: update issue ${id} via reef web app`,
        });
      },
    });

    return Response.json({ issue: result.issue, content: result.content });
  } catch (err) {
    logger.error({ err, vault, id }, "update_issue failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/**
 * DELETE /api/issues/[id]?vault={vault_name}
 *
 * Permanent removal. The reversible alternative is PATCH with
 * `archived_at` — wired just behind a confirm dialog in `IssueDetail`.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const context = getIssueRouteReadContext(request, id);
  if ("response" in context) return context.response;
  const { adapter, vault } = context;

  try {
    await runRouteSpan({
      name: "route.delete_issue",
      attributes: { vault, issue_id: id },
      run: () => deleteIssue({ adapter, vault, id }),
    });

    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error({ err, vault, id }, "delete_issue failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}
