import {
  getWorkspaceAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  parseVaultParam,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { runRouteSpan } from "@/lib/api/routeTracing";
import { logger } from "@/lib/logging/logger";
import {
  MarkdownTargetAccessResultSchema,
  ResolveMarkdownTargetRequestSchema,
  akbResolveMarkdownTarget,
} from "@reef/core";

/** POST /api/markdown/targets/resolve?vault={vault} */
export async function POST(request: Request): Promise<Response> {
  const vault = parseVaultParam(request);
  if (!vault) return missingVaultParamResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = ResolveMarkdownTargetRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = await getWorkspaceAkbAdapter(request, vault);
  if ("response" in adapterResult) return adapterResult.response;

  try {
    const result = await runRouteSpan({
      name: "route.resolve_markdown_target",
      attributes: { vault },
      run: () =>
        akbResolveMarkdownTarget({
          adapter: adapterResult.adapter,
          vault,
          target: parsed.data.target,
        }),
    });
    return Response.json(MarkdownTargetAccessResultSchema.parse(result));
  } catch (err) {
    logger.error({ err, vault }, "resolve_markdown_target failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
