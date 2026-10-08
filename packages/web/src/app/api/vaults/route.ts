import {
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  type AuthError,
  type EnrichedVaultSummary,
  type Config,
  ConfigSchema,
  AuthError as AkbAuthError,
  CreateVaultRequestSchema,
  EnrichedVaultSummarySchema,
  akbReadMemberInstallationActive as readMemberInstallationActive,
  akbCreateVault as createVault,
  akbReadConfig as readConfig,
  akbListVaults as listVaults,
  isAkbAccountErrorCode,
} from "@reef/core";
import { z } from "zod";
import { readInstallationTarget } from "@/server/adapters/installationTarget";

/**
 * GET /api/vaults → { vaults: EnrichedVaultSummary[] }
 *
 * Lists accessible AKB vaults with the minimal member-scoped installation
 * availability projection. Workspace readiness stays on selected-workspace
 * routes.
 */

const VaultsResponseSchema = z.object({
  vaults: z.array(EnrichedVaultSummarySchema),
});

const CreateVaultResponseSchema = z.object({
  vault_id: z.string().min(1),
  name: z.string().min(1),
  config: ConfigSchema,
});

function isSessionOrAccountDenial(error: unknown): error is AuthError {
  return (
    error instanceof AkbAuthError &&
    (error.context.status === 401 || isAkbAccountErrorCode(error.context.code))
  );
}

export async function GET(request: Request): Promise<Response> {
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;
  const { adapter } = adapterResult;

  try {
    const { vaults } = await listVaults({ adapter });

    const target = readInstallationTarget();
    const installationChecks = await Promise.allSettled(
      vaults.map((vault) =>
        target && vault.id
          ? readMemberInstallationActive({
              adapter,
              appId: target.appId,
              vaultId: vault.id,
            })
          : Promise.resolve(null),
      ),
    );
    const unknownCount = installationChecks.filter(
      (check) =>
        check.status === "rejected" && !isSessionOrAccountDenial(check.reason),
    ).length;
    if (unknownCount > 0) {
      logger.error(
        {
          route: "/api/vaults",
          vault_count: vaults.length,
          unknown_count: unknownCount,
        },
        "installation active reads failed during /api/vaults fan-out",
      );
    }

    const enriched: EnrichedVaultSummary[] = vaults.map((vault, idx) => {
      const check = installationChecks[idx];
      if (check.status === "fulfilled") {
        return {
          ...vault,
          installation_active: check.value,
        };
      }
      if (isSessionOrAccountDenial(check.reason)) throw check.reason;
      return { ...vault, installation_active: null };
    });

    return Response.json(VaultsResponseSchema.parse({ vaults: enriched }), {
      headers: { "Cache-Control": "no-store" },
    });
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
    const existing = vaults.find((vault) => vault.name === name);
    let vaultId: string;

    if (existing) {
      const current = await readConfig({ adapter, vault: name });
      if (current.exists || !existing.id) {
        return Response.json(
          { error: "A workspace with that name already exists." },
          { status: 409 },
        );
      }
      vaultId = existing.id;
    } else {
      const created = await createVault({ adapter, name, description });
      vaultId = created.vault_id;
    }

    return Response.json(
      CreateVaultResponseSchema.parse({ vault_id: vaultId, name, config }),
    );
  } catch (err) {
    logger.error({ err, vault: name }, "create_vault failed");
    return respondWithError(err, { resourceKind: "workspace" });
  }
}
