import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { NotFoundError, akbListTemplates as listTemplates } from "@reef/core";

/**
 * GET /api/templates?vault={vault_name} → { entries: TemplateEntry[] }
 *
 * First-run: when the `reef_templates` table does not exist yet, `listTemplates`
 * surfaces an empty list (not an error) so Settings can show the seed-defaults
 * CTA. The `NotFoundError` catch below is a defensive belt-and-braces.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const entries = await listTemplates({ adapter, vault });
    return Response.json({ entries });
  } catch (err) {
    // Load-bearing first-run shim: an absent reef_templates table surfaces as
    // NotFoundError and should read as an empty list, NOT a 404.
    if (err instanceof NotFoundError) return Response.json({ entries: [] });
    logger.error({ err, vault }, "list_templates failed");
    return respondWithError(err, { resourceKind: "template" });
  }
}
