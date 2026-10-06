import { ControlPlaneError, NotFoundError } from "../../../errors";
import {
  WorkspaceReadinessCheckSchema,
  type WorkspaceReadinessCheck,
} from "../../../schemas/controlPlane";
import type {
  ControlPlaneInstallation,
  ControlPlaneInstallationLifecycle,
} from "../../../schemas/controlPlane";
import type { AkbAdapter } from "../core/http";
import { verifyRequiredTables } from "../core/verifyRequiredTables";
import {
  readInstallation,
  readMemberInstallationActive,
} from "../controlPlane/installationLifecycle";
import { hasReefVaultSkillDocuments } from "../vaultSkill/vaultSkill";
import { readConfig } from "./config";
import { listTemplates } from "./templates";
import { withSpan } from "../core/tracing";

const NON_ACTIVE_LIFECYCLES = [
  "installing",
  "upgrading",
  "blocked",
  "uninstalled",
] as const satisfies readonly Exclude<
  ControlPlaneInstallationLifecycle,
  "active"
>[];

async function isReefInitializationComplete(params: {
  adapter: AkbAdapter;
  vault: string;
  requiredTemplateNames: readonly string[];
}): Promise<boolean> {
  const [config, templates, hasSkillDocuments] = await Promise.all([
    readConfig(params),
    listTemplates(params),
    hasReefVaultSkillDocuments(params),
  ]);
  if (!config.exists || !hasSkillDocuments) return false;
  const names = new Set(templates.map(({ template }) => template.name));
  return params.requiredTemplateNames.every((name) => names.has(name));
}

/**
 * Read the canonical AKB installation state, then verify Reef's required
 * tables and product initialization before reporting the workspace active.
 * The only writes remain the separately invoked owner initialization command.
 */
export async function checkWorkspaceReadiness(params: {
  adapter: AkbAdapter;
  appId: string;
  vaultId: string;
  vault: string;
  canManage: boolean;
  requiredTemplateNames: readonly string[];
}): Promise<WorkspaceReadinessCheck> {
  const { adapter, appId, vaultId, vault, canManage, requiredTemplateNames } =
    params;
  return withSpan(
    "akb.workspace.readiness",
    {
      vault,
      "workspace.vault_id": vaultId,
      "workspace.can_manage": canManage,
    },
    async (span) => {
      if (!canManage) {
        const active = await readMemberInstallationActive({
          adapter,
          appId,
          vaultId,
        });
        if (!active) {
          span.setAttribute("workspace.canonical_active", false);
          return WorkspaceReadinessCheckSchema.parse({ state: "inactive" });
        }
      }

      let installation: ControlPlaneInstallation | undefined;
      if (canManage) {
        try {
          installation = await readInstallation({ adapter, appId, vaultId });
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
          const config = await readConfig({ adapter, vault });
          return WorkspaceReadinessCheckSchema.parse({
            state: config.exists ? "adoption_required" : "not_installed",
          });
        }
        const currentInstallation = installation;
        if (!currentInstallation) {
          throw new ControlPlaneError({
            category: "invalid_response",
            operation: "workspace.readiness",
            upstreamStatus: 200,
            httpStatus: 502,
            retryable: false,
            upstreamCode: "workspace_installation_missing",
          });
        }
        if (currentInstallation.lifecycle !== "active") {
          const state = NON_ACTIVE_LIFECYCLES.find(
            (lifecycle) => lifecycle === currentInstallation.lifecycle,
          );
          if (!state) {
            throw new ControlPlaneError({
              category: "invalid_response",
              operation: "workspace.readiness",
              upstreamStatus: 200,
              httpStatus: 502,
              retryable: false,
              upstreamCode: "workspace_lifecycle_invalid",
            });
          }
          return WorkspaceReadinessCheckSchema.parse({
            state,
            installation: currentInstallation,
          });
        }
      }

      span.setAttribute("workspace.canonical_active", true);
      await verifyRequiredTables({ adapter, vault, canManage });
      const initializationComplete = await isReefInitializationComplete({
        adapter,
        vault,
        requiredTemplateNames,
      });
      span.setAttribute(
        "workspace.initialization_complete",
        initializationComplete,
      );
      return WorkspaceReadinessCheckSchema.parse({
        state: "active",
        ...(installation ? { installation } : {}),
        initialization_complete: initializationComplete,
      });
    },
  );
}
