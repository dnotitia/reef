import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  ResolveDocumentTitlesRequestSchema,
  akbResolveDocumentTitles as resolveDocumentTitles,
} from "@reef/core";

/**
 * POST /api/documents/resolve?vault={vault}
 *
 * Resolves markdown `akb://` document links through the server-side AKB adapter
 * so the browser never calls AKB directly or sees raw credentials.
 */
export async function POST(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = ResolveDocumentTitlesRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const documents = await runRouteSpan({
      name: "route.resolve_document_titles",
      attributes: { vault, document_count: parsed.data.uris.length },
      run: () =>
        resolveDocumentTitles({
          adapter,
          vault,
          uris: parsed.data.uris,
        }),
    });
    return Response.json({ documents });
  } catch (err) {
    logger.error({ err, vault }, "resolve_document_titles failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
