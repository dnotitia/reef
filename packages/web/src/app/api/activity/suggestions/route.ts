import { localizedErrorResponse } from "@/lib/api/errorLocalization";
import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  ActivitySuggestionStatusSchema,
  akbEnsureReefTables,
  akbListActivitySuggestions,
} from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status = statusParam
    ? ActivitySuggestionStatusSchema.safeParse(statusParam)
    : null;
  if (statusParam && (!status || !status.success)) {
    return localizedErrorResponse("invalidSuggestionStatus", 400);
  }

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    await akbEnsureReefTables({ adapter, vault });
    const result = await akbListActivitySuggestions({
      adapter,
      vault,
      ...(status?.success ? { status: status.data } : {}),
    });
    return Response.json(result, { status: 200 });
  } catch (err) {
    logger.error({ err, vault }, "list_activity_suggestions failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
