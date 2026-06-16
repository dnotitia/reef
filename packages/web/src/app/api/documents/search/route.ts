import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  type DocumentSearchHit,
  akbSearchDocuments as searchDocuments,
} from "@reef/core";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
// akb search ranks documents/tables/files together and exposes no source-type
// filter, so over-fetch and keep the top `limit` documents AFTER filtering;
// otherwise tables/files in the top slice could crowd out real documents.
const AKB_MAX_LIMIT = 100;
const OVERFETCH_FACTOR = 4;

/**
 * GET /api/documents/search?vault={vault}&q={query}&limit={n}
 *
 * Typeahead for the issue document-reference picker (REEF-083). akb's search
 * term is a REQUIRED `q`, so an empty/whitespace query short-circuits to an
 * empty list here rather than 422-ing downstream. Hits are projected onto
 * DocumentSearchHit so the client does not depends on the raw akb envelope.
 *
 * The adapter is per-request; the akb JWT lives in the `__reef_session`
 * httpOnly cookie and does not touches module scope or logs.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim();
  if (!query) return Response.json({ documents: [] });

  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const fetchLimit = Math.min(limit * OVERFETCH_FACTOR, AKB_MAX_LIMIT);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const documents = await runRouteSpan({
      name: "route.search_documents",
      attributes: { vault },
      run: async () => {
        const hits = await searchDocuments({
          adapter,
          vault,
          query,
          limit: fetchLimit,
        });
        // akb search is generalized over documents / tables / files; just a
        // document can be linked as a reference, so drop non-document hits and
        // keep the top `limit` (the mutation boundary also rejects non-doc URIs).
        return hits
          .filter((hit) => hit.source_type === "document")
          .slice(0, limit)
          .map(
            (hit): DocumentSearchHit => ({
              uri: hit.uri,
              title: hit.title ?? null,
              collection: hit.collection ?? null,
              doc_type: hit.doc_type ?? null,
              summary: hit.summary ?? null,
              matched_section: hit.matched_section ?? null,
            }),
          );
      },
    });
    return Response.json({ documents });
  } catch (err) {
    logger.error({ err, vault }, "search_documents failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
