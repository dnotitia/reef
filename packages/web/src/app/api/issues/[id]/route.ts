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
 * GET /api/issues/[id]?vault={vault_name} → { issue, content, commit_hash }
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

    // commit_hash is the OCC base the edit form holds and echoes back as
    // expected_commit on save (REEF-227).
    return Response.json({
      issue: result.issue,
      content: result.content,
      commit_hash: result.commit_hash,
    });
  } catch (err) {
    logger.error({ err, vault, id }, "read_issue failed");
    return respondWithError(err, { resourceKind: "issue" });
  }
}

/**
 * PATCH /api/issues/[id]
 *
 * Row-only scalar edits are last-write-wins; akb merges per-field server-side so
 * concurrent metadata edits coexist. Document-projected edits (body/title/
 * labels/relations) may carry `update.expected_commit` (REEF-227): the OCC base
 * is forwarded to akb, which rejects a stale write with 409 → ConflictError. A
 * `null` value in the patch is the "clear this field" sentinel (used by the
 * unarchive flow on `archived_at`) — `akbUpdateIssue` drops keys with explicit
 * null.
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
          // OCC base for document-projected edits (REEF-227). updateIssue only
          // applies it when the edit is document-dirty; row-only edits ignore it.
          ...(update.expected_commit !== undefined
            ? { expectedCommit: update.expected_commit }
            : {}),
          message: `feat: update issue ${id} via reef web app`,
        });
      },
    });

    // Echo the post-write commit so the client advances its OCC base and the
    // next edit does not false-conflict against its own prior save (REEF-227).
    return Response.json({
      issue: result.issue,
      content: result.content,
      commit_hash: result.commit_hash,
    });
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
