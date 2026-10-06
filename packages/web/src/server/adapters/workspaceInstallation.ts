import {
  type AkbAdapter,
  type ControlPlaneInstallation,
  type ControlPlaneInstallationCommandResult,
  type WorkspaceReadinessCheck,
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

type WorkspaceReadinessInspection =
  | { status: "target_unavailable" | "unknown" }
  | {
      canManage: boolean;
      readiness: WorkspaceReadinessCheck;
      target: NonNullable<ReturnType<typeof readInstallationTarget>>;
      vaultId: string;
    };

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

async function inspectWorkspaceReadiness(params: {
  adapter: AkbAdapter;
  vault: VaultSummary;
}): Promise<WorkspaceReadinessInspection> {
  const target = readInstallationTarget();
  if (!target) return { status: "target_unavailable" };
  if (!params.vault.id) return { status: "unknown" };

  const canManage = hasManagementRole(params.vault.role);
  const readiness = await akbCheckWorkspaceReadiness({
    adapter: params.adapter,
    appId: target.appId,
    vaultId: params.vault.id,
    vault: params.vault.name,
    canManage,
    requiredTemplateNames: DEFAULT_ISSUE_TEMPLATES.map(({ name }) => name),
  });
  return { canManage, readiness, target, vaultId: params.vault.id };
}

function stateFromReadiness(
  readiness: WorkspaceReadinessCheck,
): WorkspaceInstallationState {
  if (readiness.state === "inactive") {
    return { installation_status: "management_required" };
  }
  if (readiness.state !== "active") {
    return {
      installation_status: readiness.state,
      ...("installation" in readiness && readiness.installation
        ? { installation: readiness.installation }
        : {}),
    };
  }
  if (!readiness.initialization_complete) {
    return {
      installation_status: "management_required",
      ...(readiness.installation
        ? { installation: readiness.installation }
        : {}),
    };
  }
  return {
    installation_status: "ready",
    ...(readiness.installation ? { installation: readiness.installation } : {}),
  };
}

/** Read readiness without initializing or otherwise changing the workspace. */
export async function readWorkspaceInstallationStatus(params: {
  adapter: AkbAdapter;
  vault: VaultSummary;
}): Promise<WorkspaceInstallationState> {
  const inspection = await inspectWorkspaceReadiness(params);
  if ("status" in inspection) {
    return { installation_status: inspection.status };
  }
  return stateFromReadiness(inspection.readiness);
}

/** Read AKB's canonical state and initialize Reef data only after it is active. */
export async function readWorkspaceInstallationState(params: {
  adapter: AkbAdapter;
  vault: VaultSummary;
}): Promise<WorkspaceInstallationState> {
  const { adapter, vault } = params;
  const inspection = await inspectWorkspaceReadiness({ adapter, vault });
  if ("status" in inspection) {
    return { installation_status: inspection.status };
  }
  const { canManage, readiness: check, target, vaultId } = inspection;
  if (check.state === "inactive") {
    return { installation_status: "management_required" };
  }
  if (check.state === "not_installed" || check.state === "adoption_required") {
    return { installation_status: check.state };
  }
  if (check.state !== "active") {
    return stateFromReadiness(check);
  }
  if (check.initialization_complete) {
    return stateFromReadiness(check);
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
    vaultId,
    vault: vault.name,
    canManage,
    requiredTemplateNames: DEFAULT_ISSUE_TEMPLATES.map(({ name }) => name),
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
