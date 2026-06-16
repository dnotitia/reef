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
  akbCreateVault as createVault,
  akbInstallReefVaultSkill as installReefVaultSkill,
  akbListVaults as listVaults,
  akbReadConfig as readConfig,
  akbWriteConfig as writeConfig,
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

const CreateVaultResponseSchema = z.object({
  name: z.string().min(1),
  config: ConfigSchema,
});

export async function GET(request: Request): Promise<Response> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const { vaults } = await listVaults({ adapter });

    const configChecks = await Promise.allSettled(
      vaults.map((v) => readConfig({ adapter, vault: v.name })),
    );

    const enriched: EnrichedVaultSummary[] = vaults.map((v, idx) => {
      const check = configChecks[idx];
      if (check.status === "fulfilled") {
        return { ...v, has_reef_config: check.value.exists };
      }
      // One failing vault should not blow up the whole list — fall back to
      // `false` (treated as "not configured for reef") and log for
      // observability. NotFoundError is already mapped to {exists: false}
      // inside readConfig, so reaching here means a real failure (auth,
      // network, schema).
      logger.error(
        { err: check.reason, vault: v.name },
        "readConfig failed during /api/vaults fan-out",
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
    const { vaults } = await listVaults({ adapter });
    const existing = vaults.find((v) => v.name === name);

    if (existing) {
      const current = await readConfig({ adapter, vault: name });
      if (current.exists) {
        return Response.json(
          { error: "A workspace with that name is already configured." },
          { status: 409 },
        );
      }
    } else {
      await createVault({ adapter, name, description });
    }

    await installReefVaultSkill({ adapter, vault: name });

    // writeConfig provisions the reef tables lazily (idempotent), so the
    // brownfield/greenfield branches and the Settings PATCH path all reach a
    // ready vault through one code path.
    await writeConfig({
      adapter,
      vault: name,
      config,
      message: "Initialize reef workspace config",
    });

    return Response.json(CreateVaultResponseSchema.parse({ name, config }));
  } catch (err) {
    logger.error({ err, vault: name }, "create_vault failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
