import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  type AkbAdapter,
  type Config,
  ConfigSchema,
  CreateVaultRequestSchema,
  type EnrichedVaultSummary,
  EnrichedVaultSummarySchema,
  akbCreateVault as createVault,
  akbInstallReefVaultSkill as installReefVaultSkill,
  akbListVaults as listVaults,
  akbReadConfig as readConfig,
  akbRegisterVaultMigrationWriter as registerVaultMigrationWriter,
  akbRestoreVaultMigrationWriter as restoreVaultMigrationWriter,
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

async function restoreMigrationWriter({
  adapter,
  vault,
  username,
  previousRole,
}: {
  adapter: AkbAdapter;
  vault: string;
  username: string;
  previousRole: "reader" | "writer" | null;
}): Promise<void> {
  try {
    await restoreVaultMigrationWriter({
      adapter,
      vault,
      username,
      previousRole,
    });
  } catch (rollbackError) {
    logger.error(
      { err: rollbackError, vault },
      "migration_writer_rollback failed",
    );
    throw rollbackError;
  }
}

function configsMatch(left: Config, right: Config): boolean {
  return JSON.stringify(ConfigSchema.parse(left)) === JSON.stringify(right);
}

// The supported deployment is one Next.js process (`replicas: 1` with
// `strategy: Recreate` in deploy/k8s/base/deployment.yaml). This process-local
// queue serializes the registration/compensation critical section without
// introducing persistent web state. Scaling the web tier requires an upstream
// conditional-grant primitive before this rollback protocol can stay safe.
const initializationTails = new Map<string, Promise<void>>();

async function withVaultInitializationLock<T>(
  vault: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = initializationTails.get(vault) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  initializationTails.set(vault, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (initializationTails.get(vault) === tail) {
      initializationTails.delete(vault);
    }
  }
}

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

  return withVaultInitializationLock(name, async () => {
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

      // Install first so any later grant/rollback ambiguity has a durable
      // initialization stamp that the startup runner will fail on rather than
      // silently classifying the vault as raw. The Reef config marker remains
      // last and is never written before writer registration is confirmed.
      await installReefVaultSkill({ adapter, vault: name });

      const migrationAccount =
        process.env.REEF_AKB_MIGRATION_SERVICE_ACCOUNT ?? "";
      const registration = await registerVaultMigrationWriter({
        adapter,
        vault: name,
        username: migrationAccount,
      });

      try {
        // writeConfig provisions the reef tables lazily (idempotent), so the
        // brownfield/greenfield branches and the Settings PATCH path all reach a
        // ready vault through one code path.
        await writeConfig({
          adapter,
          vault: name,
          config,
          message: "Initialize reef workspace config",
        });
      } catch (initializationError) {
        let readback: Awaited<ReturnType<typeof readConfig>>;
        try {
          readback = await readConfig({ adapter, vault: name });
        } catch (readbackError) {
          // The marker state is ambiguous. Preserve writer membership so a
          // possibly committed Reef workspace cannot disappear from startup
          // inventory; the failed request remains visible for operator retry.
          logger.error(
            { err: readbackError, vault: name },
            "workspace_initialization_readback failed",
          );
          throw initializationError;
        }
        if (readback.exists) {
          if (configsMatch(readback.config, config)) {
            // The write committed and only its response was lost.
          } else {
            // A Reef marker exists, so retain migration membership even though
            // the conflicting config keeps this request failed.
            throw initializationError;
          }
        } else {
          await restoreMigrationWriter({
            adapter,
            vault: name,
            username: migrationAccount,
            previousRole: registration.previousRole,
          });
          throw initializationError;
        }
      }

      return Response.json(CreateVaultResponseSchema.parse({ name, config }));
    } catch (err) {
      logger.error({ err, vault: name }, "create_vault failed");
      return respondWithError(err, { resourceKind: "workspace" });
    }
  });
}
