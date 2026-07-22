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
  akbUpdateActivitySuggestionStatus,
  akbVerifyWorkspaceSchema,
} from "@reef/core";
import { z } from "zod";

const SuggestionIdSchema = z
  .string()
  .regex(/^reef-(draft|status)-[a-f0-9]{16}$/, "Invalid suggestion id");

const DismissSuggestionRequestSchema = z.object({
  vault: VaultNameSchema,
});

export async function POST(
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

  const parsed = DismissSuggestionRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);
  const { vault } = parsed.data;

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await akbVerifyWorkspaceSchema({ adapter, vault });
    const result = await akbUpdateActivitySuggestionStatus({
      adapter,
      vault,
      id,
      status: "dismissed",
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err, vault, id }, "dismiss_activity_suggestion failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
