import {
  type AkbAdapter,
  type ControlPlaneInstallation,
  type ControlPlaneInstallationCommandResult,
  type WorkspaceInstallationStatus,
  AkbApiError,
  ControlPlaneError,
  NotFoundError,
  SchemaValidationError,
  WorkspaceReadinessError,
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
  throw readinessErrorForState(state);
}

function readinessErrorForState(
  state: WorkspaceInstallationState,
): WorkspaceReadinessError {
  const installation = state.installation;
  switch (state.installation_status) {
    case "not_installed":
    case "uninstalled":
      return new WorkspaceReadinessError({
        reason: "installation_required",
        status: 409,
      });
    case "installing":
      return new WorkspaceReadinessError({
        reason: "installation_in_progress",
        status: 409,
      });
    case "upgrading":
      return new WorkspaceReadinessError({
        reason: "upgrade_in_progress",
        status: 409,
      });
    case "blocked":
      return new WorkspaceReadinessError({
        reason: "installation_blocked",
        status: 409,
        ...(installation?.blockedReason
          ? { blockedReason: installation.blockedReason }
          : {}),
      });
    case "adoption_required":
      return new WorkspaceReadinessError({
        reason: "adoption_required",
        status: 409,
      });
    case "management_required":
      return new WorkspaceReadinessError({
        reason: "management_required",
        status: 403,
      });
    case "target_unavailable":
    case "unknown":
      return new WorkspaceReadinessError({
        reason: "installation_status_unavailable",
        status: 503,
      });
    case "ready":
      return new WorkspaceReadinessError({
        reason: "owner_action_required",
        status: 409,
      });
  }
}

function isInstallationStatusUnavailable(error: unknown): boolean {
  if (error instanceof ControlPlaneError) {
    return [
      "unavailable",
      "transport",
      "invalid_response",
      "rate_limited",
    ].includes(error.category);
  }
  if (error instanceof AkbApiError) {
    return error.context.status === 429 || error.context.status >= 500;
  }
  return (
    error instanceof SchemaValidationError &&
    error.context.clientValidated !== true
  );
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
  const canManage = hasManagementRole(vault.role);
  const target = readInstallationTarget();
  if (!target) {
    return {
      installation_status: canManage
        ? "target_unavailable"
        : "management_required",
    };
  }
  if (!vault.id) {
    return {
      installation_status: canManage ? "unknown" : "management_required",
    };
  }
  const vaultId = vault.id;
  const requiredTemplateNames = DEFAULT_ISSUE_TEMPLATES.map(({ name }) => name);
  const checkReadiness = async () => {
    try {
      return await akbCheckWorkspaceReadiness({
        adapter,
        appId: target.appId,
        vaultId,
        vault: vault.name,
        canManage,
        requiredTemplateNames,
      });
    } catch (error) {
      if (isInstallationStatusUnavailable(error)) {
        throw new WorkspaceReadinessError({
          reason: "installation_status_unavailable",
          status: 503,
        });
      }
      throw error;
    }
  };
  const check = await checkReadiness();
  if (check.state === "inactive") {
    return { installation_status: "management_required" };
  }
  if (!canManage && check.state !== "active") {
    return { installation_status: "management_required" };
  }
  if (check.state === "not_installed" || check.state === "adoption_required") {
    return { installation_status: check.state };
  }
  if (check.state !== "active") {
    return {
      installation_status: check.state,
      ...(canManage && check.installation
        ? { installation: check.installation }
        : {}),
    };
  }
  if (check.initialization_complete) {
    return {
      installation_status: "ready",
      ...(canManage && check.installation
        ? { installation: check.installation }
        : {}),
    };
  }
  if (!canManage) return { installation_status: "management_required" };

  await akbInitializeReefWorkspace({
    adapter,
    vault: vault.name,
    defaultTemplates: DEFAULT_ISSUE_TEMPLATES,
  });
  const afterInitialization = await checkReadiness();
  return afterInitialization.state === "active" &&
    afterInitialization.initialization_complete
    ? {
        installation_status: "ready",
        ...(canManage && afterInitialization.installation
          ? { installation: afterInitialization.installation }
          : {}),
      }
    : {
        installation_status: "management_required",
        ...(afterInitialization.state === "active" &&
        canManage &&
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
