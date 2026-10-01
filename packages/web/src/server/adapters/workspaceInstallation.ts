import {
  type AkbAdapter,
  type ControlPlaneInstallation,
  type ControlPlaneInstallationCommandResult,
  type WorkspaceInstallationStatus,
  ControlPlaneError,
  NotFoundError,
  akbListVaults,
  akbInitializeReefWorkspace,
  akbCheckWorkspaceReadiness,
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

/** Read AKB's canonical state and initialize Reef data only after it is active. */
export async function readWorkspaceInstallationState(params: {
  adapter: AkbAdapter;
  vault: VaultSummary;
}): Promise<WorkspaceInstallationState> {
  const { adapter, vault } = params;
  const target = readInstallationTarget();
  if (!target) return { installation_status: "target_unavailable" };
  if (!vault.id) return { installation_status: "unknown" };
  const canManage = hasManagementRole(vault.role);
  const requiredTemplateNames = DEFAULT_ISSUE_TEMPLATES.map(({ name }) => name);
  const check = await akbCheckWorkspaceReadiness({
    adapter,
    appId: target.appId,
    vaultId: vault.id,
    vault: vault.name,
    canManage,
    requiredTemplateNames,
  });
  if (check.state === "inactive") {
    return { installation_status: "management_required" };
  }
  if (check.state === "not_installed" || check.state === "adoption_required") {
    return { installation_status: check.state };
  }
  if (check.state !== "active") {
    return {
      installation_status: check.state,
      installation: check.installation,
    };
  }
  if (check.initialization_complete) {
    return {
      installation_status: "ready",
      ...(check.installation ? { installation: check.installation } : {}),
    };
  }
  if (!canManage) return { installation_status: "management_required" };

  await akbInitializeReefWorkspace({
    adapter,
    vault: vault.name,
    defaultTemplates: DEFAULT_ISSUE_TEMPLATES,
  });
  const afterInitialization = await akbCheckWorkspaceReadiness({
    adapter,
    appId: target.appId,
    vaultId: vault.id,
    vault: vault.name,
    canManage,
    requiredTemplateNames,
  });
  return afterInitialization.state === "active" &&
    afterInitialization.initialization_complete
    ? {
        installation_status: "ready",
        ...(afterInitialization.installation
          ? { installation: afterInitialization.installation }
          : {}),
      }
    : {
        installation_status: "management_required",
        ...(afterInitialization.state === "active" &&
        afterInitialization.installation
          ? { installation: afterInitialization.installation }
          : {}),
      };
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
