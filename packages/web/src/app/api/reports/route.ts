import {
  SchemaValidationError,
  ReportRequestSchema,
  akbGetReports,
} from "@reef/core";
import {
  getAkbAdapter,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";

/** GET /api/reports?vault={vault}&{filters,axes,asOf} → validated report data. */
export async function GET(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  const params = new URL(request.url).searchParams;
  const parsed = ReportRequestSchema.safeParse({
    filters: {
      period: params.get("period") ?? undefined,
      scope: params.get("scope") ?? undefined,
      measure: params.get("measure") ?? undefined,
      sprint_id: params.get("sprint_id") ?? undefined,
      milestone_id: params.get("milestone_id") ?? undefined,
      release_id: params.get("release_id") ?? undefined,
      parent_id: params.get("parent_id") ?? undefined,
      assignee: params.get("assignee") ?? undefined,
      label: params.get("label") ?? undefined,
    },
    asOf: params.has("asOf") ? Number(params.get("asOf")) : Date.now(),
    rollupDimension: params.get("rollupDimension") ?? undefined,
    pivotRow: params.get("pivotRow") ?? undefined,
    pivotCol: params.get("pivotCol") ?? undefined,
  });
  if (!parsed.success) {
    return respondWithError(
      new SchemaValidationError({
        issues: ["Report filters or dimensions are invalid"],
      }),
      { resourceKind: "workspace" },
    );
  }
  const reportRequest = parsed.data;

  try {
    const result = await runRouteSpan({
      name: "route.get_reports",
      attributes: {
        vault,
        period: reportRequest.filters.period,
        scope: reportRequest.filters.scope,
        measure: reportRequest.filters.measure,
        rollup_dimension: reportRequest.rollupDimension,
      },
      run: () => akbGetReports({ adapter, vault, request: reportRequest }),
    });
    return Response.json(result);
  } catch (err) {
    logger.error(
      { error_name: err instanceof Error ? err.name : "UnknownError", vault },
      "get_reports failed",
    );
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
