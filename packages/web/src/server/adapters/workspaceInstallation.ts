import {
  type AkbAdapter,
  type ControlPlaneInstallation,
  type ControlPlaneInstallationCommandResult,
  type WorkspaceInstallationStatus,
  ControlPlaneError,
  NotFoundError,
  akbListVaults,
  akbHasReefVaultSkillDocuments,
  akbInitializeReefWorkspace,
  akbListTemplates,
  akbReadConfig,
  akbReadInstallation,
  akbReadMemberInstallationActive,
  akbRequestInstallation,
  akbUninstallInstallation,
  type VaultSummary,
} from "@reef/core";
import { DEFAULT_ISSUE_TEMPLATES } from "@/features/settings/lib/defaultIssueTemplates";
import { readInstallationTarget } from "./installationTarget";

export interface WorkspaceInstallationState {
  installation_status: WorkspaceInstallationStatus;
  installation?: ControlPlaneInstallation;
}

export async function requireWorkspaceReady(params: {
  adapter: AkbAdapter;
  vaultName: string;
}): Promise<WorkspaceInstallationState> {
  const { adapter, vaultName } = params;
  const { vaults } = await akbListVaults({ adapter });
  const vault = vaults.find((candidate) => candidate.name === vaultName);
  if (!vault) throw new NotFoundError({ resource: `vault ${vaultName}` });
  const state = await readWorkspaceInstallationState({ adapter, vault });
  if (state.installation_status === "ready") return state;

  const managementRequired =
    state.installation_status === "management_required";
  const targetUnavailable =
    state.installation_status === "target_unavailable" ||
    state.installation_status === "unknown";
  throw new ControlPlaneError({
    category: managementRequired
      ? "authorization"
      : targetUnavailable
        ? "unavailable"
        : "conflict",
    operation: "workspace.ready",
    upstreamStatus: 0,
    httpStatus: managementRequired ? 403 : targetUnavailable ? 503 : 409,
    retryable: targetUnavailable,
    upstreamCode: state.installation_status,
  });
}

function hasManagementRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

async function isReefInitializationComplete(params: {
  adapter: AkbAdapter;
  vault: string;
}): Promise<boolean> {
  const [config, templates, hasSkillDocuments] = await Promise.all([
    akbReadConfig(params),
    akbListTemplates(params),
    akbHasReefVaultSkillDocuments(params),
  ]);
  if (!config.exists || !hasSkillDocuments) return false;
  const names = new Set(templates.map(({ template }) => template.name));
  return DEFAULT_ISSUE_TEMPLATES.every(({ name }) => names.has(name));
}

/** Read AKB's canonical state and initialize Reef data only after it is active. */
export async function readWorkspaceInstallationState(params: {
  adapter: AkbAdapter;
  vault: VaultSummary;
}): Promise<WorkspaceInstallationState> {
  const { adapter, vault } = params;
  const target = readInstallationTarget();
  if (!target) return { installation_status: "target_unavailable" };
  if (!vault.id) return { installation_status: "unknown" };

  if (!hasManagementRole(vault.role)) {
    const active = await akbReadMemberInstallationActive({
      adapter,
      appId: target.appId,
      vaultId: vault.id,
    });
    if (!active) {
      return { installation_status: "management_required" };
    }
    return {
      installation_status: (await isReefInitializationComplete({
        adapter,
        vault: vault.name,
      }))
        ? "ready"
        : "management_required",
    };
  }

  let installation: ControlPlaneInstallation;
  try {
    installation = await akbReadInstallation({
      adapter,
      appId: target.appId,
      vaultId: vault.id,
    });
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    const config = await akbReadConfig({ adapter, vault: vault.name });
    return {
      installation_status: config.exists
        ? "adoption_required"
        : "not_installed",
    };
  }
  if (installation.lifecycle !== "active") {
    return {
      installation_status: installation.lifecycle,
      installation,
    };
  }

  if (
    !(await isReefInitializationComplete({
      adapter,
      vault: vault.name,
    }))
  ) {
    await akbInitializeReefWorkspace({
      adapter,
      vault: vault.name,
      defaultTemplates: DEFAULT_ISSUE_TEMPLATES,
    });
    if (
      !(await isReefInitializationComplete({
        adapter,
        vault: vault.name,
      }))
    ) {
      return { installation_status: "management_required", installation };
    }
  }
  return { installation_status: "ready", installation };
}

export async function requestWorkspaceInstallation(params: {
  adapter: AkbAdapter;
  vault: VaultSummary;
  mode: "install" | "restore" | "fresh";
}): Promise<ControlPlaneInstallationCommandResult> {
  const { adapter, vault, mode } = params;
  const target = readInstallationTarget();
  if (!target) throw releaseTargetUnavailable();
  if (!vault.id) throw new Error("vault_id_unavailable");

  return akbRequestInstallation({
    adapter,
    appId: target.appId,
    vaultId: vault.id,
    releaseId: target.releaseId,
    mode,
  });
}

export async function uninstallWorkspaceInstallation(params: {
  adapter: AkbAdapter;
  vault: VaultSummary;
}): Promise<ControlPlaneInstallationCommandResult> {
  const { adapter, vault } = params;
  const target = readInstallationTarget();
  if (!target) throw releaseTargetUnavailable();
  if (!vault.id) throw new Error("vault_id_unavailable");

  return akbUninstallInstallation({
    adapter,
    appId: target.appId,
    vaultId: vault.id,
  });
}

function releaseTargetUnavailable(): ControlPlaneError {
  return new ControlPlaneError({
    category: "unavailable",
    operation: "installation.target",
    upstreamStatus: 0,
    httpStatus: 503,
    retryable: false,
    upstreamCode: "release_target_unavailable",
  });
}
