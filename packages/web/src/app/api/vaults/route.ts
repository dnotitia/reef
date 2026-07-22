import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  type Config,
  ConfigSchema,
  CreateVaultRequestSchema,
  type EnrichedVaultSummary,
  EnrichedVaultSummarySchema,
  WorkspaceInitializationResultSchema,
  akbInitializeWorkspace as initializeWorkspace,
  akbIsWorkspaceInitializationReady as isWorkspaceInitializationReady,
  akbListVaults as listVaults,
  akbReadConfig as readConfig,
} from "@reef/core";
import { z } from "zod";

/**
 * GET /api/vaults → { vaults: EnrichedVaultSummary[] }
 *
 * Lists the akb vaults the current user can access; backs Settings and the
 * existing-workspace path in onboarding. Each entry is enriched with
 * `has_reef_config` by fanning out `readConfig` per vault, so callers can
 * distinguish reef-ready workspaces from raw akb vaults.
 */

const VaultsResponseSchema = z.object({
  vaults: z.array(EnrichedVaultSummarySchema),
});

export async function GET(request: Request): Promise<Response> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const { vaults } = await listVaults({ adapter });

    const readinessChecks = await Promise.allSettled(
      vaults.map(async (v) => {
        const config = await readConfig({ adapter, vault: v.name });
        if (!config.exists) return false;
        return isWorkspaceInitializationReady(adapter, v.name);
      }),
    );

    const enriched: EnrichedVaultSummary[] = vaults.map((v, idx) => {
      const check = readinessChecks[idx];
      if (check.status === "fulfilled") {
        return { ...v, has_reef_config: check.value };
      }
      // One failing vault should not blow up the whole list — fall back to
      // `false` (treated as "not configured for reef") and log for
      // observability. NotFoundError is already mapped to {exists: false}
      // inside readConfig, so reaching here means a real failure (auth,
      // network, schema).
      logger.error(
        { err: check.reason, vault: v.name },
        "workspace readiness check failed during /api/vaults fan-out",
      );
      return { ...v, has_reef_config: false };
    });

    return Response.json(VaultsResponseSchema.parse({ vaults: enriched }));
  } catch (err) {
    logger.error({ err }, "list_vaults failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }

  const parsed = CreateVaultRequestSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const {
    name,
    description,
    project_prefix,
    monitored_repos,
    authoring_language,
  } = parsed.data;
  const config: Config = ConfigSchema.parse({
    project_prefix,
    monitored_repos,
    authoring_language,
  });

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const result = await initializeWorkspace({
      adapter,
      request: { name, description, config },
      serviceUsername: process.env.REEF_SCHEMA_SERVICE_USERNAME ?? "",
    });
    return Response.json(WorkspaceInitializationResultSchema.parse(result));
  } catch (err) {
    logger.error({ err, vault: name }, "create_vault failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
