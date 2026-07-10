import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { getDevelopmentProfileCatalog } from "@/lib/server/developmentProfiles";
import {
  DevelopmentTargetsResponseSchema,
  akbListDevelopmentTargets as listDevelopmentTargets,
} from "@reef/core";

export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;
  const catalog = await getDevelopmentProfileCatalog();

  try {
    const items = await listDevelopmentTargets({ adapter, vault, catalog });
    return Response.json(
      DevelopmentTargetsResponseSchema.parse({ items, catalog }),
    );
  } catch (err) {
    logger.error({ err, vault }, "list_development_targets failed");
    return respondWithError(err, { resourceKind: "config" });
  }
}
