import {
  VaultNameSchema,
  getAkbAdapter,
  getAkbCurrentActor,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { approveActivitySuggestion } from "@reef/core";
import { z } from "zod";

const SuggestionIdSchema = z
  .string()
  .regex(/^reef-(draft|status)-[a-f0-9]{16}$/, "Invalid suggestion id");

const ApproveSuggestionRequestSchema = z.object({
  vault: VaultNameSchema,
  prefix: z.string().min(1).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const idResult = SuggestionIdSchema.safeParse(id);
  if (!idResult.success) {
    return Response.json({ error: "Invalid suggestion id." }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = ApproveSuggestionRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const { vault, prefix } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const actorResult = await getAkbCurrentActor(request);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  try {
    const result = await approveActivitySuggestion({
      adapter,
      vault,
      id,
      actor,
      prefix,
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err, vault, id }, "approve_activity_suggestion failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
