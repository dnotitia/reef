import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  VaultNameSchema,
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  IssueCreateInputSchema,
  StatusEnum,
  akbEnsureReefTables,
  akbReadActivitySuggestion,
  akbUpdateActivitySuggestion,
} from "@reef/core";
import { z } from "zod";

const SuggestionIdSchema = z
  .string()
  .regex(/^reef-(draft|status)-[a-f0-9]{16}$/, "Invalid suggestion id");

// AI status-change suggestions are forward-moving and applied via isForwardStatus
// on approval. `closed` is final (needs a reason via the close flow) and
// `backlog` is rank 0 — no status forward-moves into it — so neither is ever a
// valid edited target; allowing them would save a suggestion that approval can
// does not accept (REEF-109).
const StatusSuggestionTargetSchema = StatusEnum.exclude(["closed", "backlog"]);
const StatusSuggestionUpdateSchema = z
  .object({
    issue_id: z.string().min(1),
    patch: z
      .object({
        status: StatusSuggestionTargetSchema,
      })
      .strict(),
  })
  .strict();

const PatchSuggestionRequestSchema = z.object({
  vault: VaultNameSchema,
  create: IssueCreateInputSchema.optional(),
  update: StatusSuggestionUpdateSchema.optional(),
  rationale: z.string().min(1).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const idResult = SuggestionIdSchema.safeParse(id);
  if (!idResult.success) {
    return localizedErrorResponse("invalidSuggestionId", 400);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = PatchSuggestionRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const { vault, create, update, rationale } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await akbEnsureReefTables({ adapter, vault });
    const current = await akbReadActivitySuggestion({ adapter, vault, id });
    if (current.suggestion.status !== "pending") {
      return localizedErrorResponse("suggestionAlreadyReviewed", 409);
    }
    if (
      current.suggestion.kind === "draft" &&
      (!create || update !== undefined || rationale !== undefined)
    ) {
      return localizedErrorResponse("suggestionDraftRequiresCreate", 400);
    }
    if (
      current.suggestion.kind === "status_change" &&
      ((!update && rationale === undefined) || create !== undefined)
    ) {
      return localizedErrorResponse("suggestionStatusRequiresUpdate", 400);
    }

    if (current.suggestion.kind === "draft") {
      if (!create) {
        return localizedErrorResponse("suggestionDraftRequiresCreate", 400);
      }
      const result = await akbUpdateActivitySuggestion({
        adapter,
        vault,
        id,
        patch: { create },
      });
      return Response.json(result, { status: 200 });
    }

    const currentStatus = current.suggestion.proposal.update.patch.status;
    const nextStatus = update?.patch.status ?? currentStatus;
    if (!nextStatus) {
      return localizedErrorResponse("activitySuggestion.statusMissing", 400);
    }
    if (
      update &&
      update.issue_id !== current.suggestion.proposal.update.issue_id
    ) {
      return localizedErrorResponse("suggestionCannotRetarget", 400);
    }
    const result = await akbUpdateActivitySuggestion({
      adapter,
      vault,
      id,
      patch: {
        update: {
          issue_id: current.suggestion.proposal.update.issue_id,
          patch: { status: nextStatus },
        },
        ...(rationale ? { rationale } : {}),
      },
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err, vault, id }, "update_activity_suggestion failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
