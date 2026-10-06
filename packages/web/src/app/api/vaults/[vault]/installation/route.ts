import {
  type VaultSummary,
  ControlPlaneInstallationSchema,
  WorkspaceInstallationStatusEnum,
  NotFoundError,
  akbListVaults as listVaults,
  describeError,
} from "@reef/core";
import {
  VAULT_NAME_RE,
  getAkbAdapter,
  invalidBodyResponse,
  invalidJsonBodyResponse,
  missingVaultParamResponse,
  respondWithError,
} from "@/lib/api/requestHelpers";
import { logger } from "@/lib/logging/logger";
import {
  readWorkspaceInstallationState,
  requestWorkspaceInstallation,
  uninstallWorkspaceInstallation,
} from "@/server/adapters/workspaceInstallation";
import { z } from "zod";

const InstallationCommandSchema = z.strictObject({
  mode: z.enum(["install", "restore", "fresh"]),
});

const InstallationResponseSchema = z.object({
  installation_status: WorkspaceInstallationStatusEnum,
  installation: ControlPlaneInstallationSchema.optional(),
});

async function findVault(
  adapter: Parameters<typeof listVaults>[0]["adapter"],
  name: string,
): Promise<VaultSummary> {
  const { vaults } = await listVaults({ adapter });
  const vault = vaults.find((candidate) => candidate.name === name);
  if (!vault) throw new NotFoundError({ resource: `vault ${name}` });
  return vault;
}

async function readState(
  adapter: Parameters<typeof listVaults>[0]["adapter"],
  vault: VaultSummary,
): Promise<Response> {
  const state = await readWorkspaceInstallationState({ adapter, vault });
  return Response.json(InstallationResponseSchema.parse(state), {
    headers: { "Cache-Control": "no-store" },
  });
}

function logInstallationFailure(
  error: unknown,
  vault: string,
  operation: "status.read" | "installation.command" | "installation.uninstall",
  message: string,
): void {
  const descriptor = describeError(error);
  logger.error(
    {
      vault,
      operation,
      error_code: descriptor.code,
      http_status: descriptor.status,
    },
    message,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vault: string }> },
): Promise<Response> {
  const { vault: name } = await params;
  if (!VAULT_NAME_RE.test(name)) return missingVaultParamResponse();
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;

  try {
    const vault = await findVault(adapterResult.adapter, name);
    return await readState(adapterResult.adapter, vault);
  } catch (error) {
    logInstallationFailure(
      error,
      name,
      "status.read",
      "installation status read failed",
    );
    return respondWithError(error, { resourceKind: "workspace" });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ vault: string }> },
): Promise<Response> {
  const { vault: name } = await params;
  if (!VAULT_NAME_RE.test(name)) return missingVaultParamResponse();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return invalidJsonBodyResponse();
  }
  const parsed = InstallationCommandSchema.safeParse(rawBody);
  if (!parsed.success) return invalidBodyResponse(parsed.error);

  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;

  try {
    const vault = await findVault(adapterResult.adapter, name);
    const acknowledgement = await requestWorkspaceInstallation({
      adapter: adapterResult.adapter,
      vault,
      mode: parsed.data.mode,
    });
    const state =
      acknowledgement.installation.lifecycle === "active"
        ? await readWorkspaceInstallationState({
            adapter: adapterResult.adapter,
            vault,
          })
        : {
            installation_status: acknowledgement.installation.lifecycle,
            installation: acknowledgement.installation,
          };
    return Response.json(
      {
        ...InstallationResponseSchema.parse(state),
        command_status: acknowledgement.commandStatus,
        replayed: acknowledgement.replayed,
      },
      {
        status: acknowledgement.replayed ? 200 : 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    logInstallationFailure(
      error,
      name,
      "installation.command",
      "installation command failed",
    );
    return respondWithError(error, { resourceKind: "workspace" });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ vault: string }> },
): Promise<Response> {
  const { vault: name } = await params;
  if (!VAULT_NAME_RE.test(name)) return missingVaultParamResponse();
  const adapterResult = getAkbAdapter(request);
  if ("response" in adapterResult) return adapterResult.response;

  try {
    const vault = await findVault(adapterResult.adapter, name);
    const acknowledgement = await uninstallWorkspaceInstallation({
      adapter: adapterResult.adapter,
      vault,
    });
    return Response.json(
      {
        installation_status: acknowledgement.installation.lifecycle,
        command_status: acknowledgement.commandStatus,
        replayed: acknowledgement.replayed,
      },
      {
        status: acknowledgement.replayed ? 200 : 202,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    logInstallationFailure(
      error,
      name,
      "installation.uninstall",
      "installation uninstall failed",
    );
    return respondWithError(error, { resourceKind: "workspace" });
  }
}
