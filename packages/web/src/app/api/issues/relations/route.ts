import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import { tracer } from "@/lib/telemetry";
import { SpanStatusCode } from "@opentelemetry/api";
import { akbListIssueRelations as listIssueRelations } from "@reef/core";

/**
 * GET /api/issues/relations?vault={vault_name} — the whole-vault relation
 * projection (reef_id / status / depends_on) for client-side blocker badges and
 * the blocked/blocking dependency filter. Small payload, no document body, so
 * the displayed list can be a server-filtered subset without breaking badges.
 */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const relations = await tracer.startActiveSpan(
      "route.list_issue_relations",
      async (span) => {
        span.setAttribute("vault", vault);
        try {
          const result = await listIssueRelations(adapter, vault);
          span.setAttribute("relation_count", result.length);
          return result;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          throw err;
        } finally {
          span.end();
        }
      },
    );

    return Response.json({ relations });
  } catch (err) {
    logger.error({ err, vault }, "list_issue_relations failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
