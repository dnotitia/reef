import { z } from "zod";
import {
  AkbApiError,
  ControlPlaneError,
  SchemaValidationError,
} from "../../../errors";
import {
  ControlPlaneCommandStatusEnum,
  ControlPlaneIdSchema,
  ControlPlaneInstallationAvailabilitySchema,
  ControlPlaneInstallationCommandResultSchema,
  type ControlPlaneInstallation,
  type ControlPlaneInstallationCommandResult,
} from "../../../schemas/controlPlane";
import { parseControlPlaneInstallation } from "./installationReader";
import type { AkbAdapter } from "../core/http";
import { withSpan } from "../core/tracing";

const CAPABILITIES = ["installation:read"] as const;
const InstallModeSchema = z.enum(["install", "restore", "fresh"]);
const CommandResponseSchema = z.looseObject({
  command_status: ControlPlaneCommandStatusEnum,
  replayed: z.boolean(),
});

export interface ReadInstallationParams {
  adapter: AkbAdapter;
  appId: string;
  vaultId: string;
}

export interface RequestInstallationParams extends ReadInstallationParams {
  mode: "install" | "restore" | "fresh";
  /** Used only for first install/fresh; restore selects AKB's retained release. */
  releaseId: string;
}

/** Read only whether this app is canonically active for an ordinary Vault member. */
export async function readMemberInstallationActive(
  params: ReadInstallationParams,
): Promise<boolean> {
  const appId = parseId(params.appId, "appId");
  const vaultId = parseId(params.vaultId, "vaultId");
  return withSpan(
    "akb.control_plane.installation.member_active",
    {
      "control_plane.operation": "installation.member_active",
      "control_plane.actor_mode": "user",
      "control_plane.app_id": appId,
      "control_plane.vault_id": vaultId,
    },
    async (span) => {
      let body: unknown;
      try {
        body = await params.adapter.request(
          `${installationPath(appId, vaultId)}/active`,
          { resource: "application installation availability" },
        );
      } catch (error) {
        if (error instanceof AkbApiError && error.status === 503) {
          throw new ControlPlaneError({
            category: "unavailable",
            operation: "installation.member_active",
            upstreamStatus: 503,
            httpStatus: 503,
            retryable: true,
            upstreamCode: "member_installation_status_unavailable",
          });
        }
        throw error;
      }

      const parsed = ControlPlaneInstallationAvailabilitySchema.safeParse(body);
      if (!parsed.success) {
        throw new ControlPlaneError({
          category: "invalid_response",
          operation: "installation.member_active",
          upstreamStatus: 200,
          httpStatus: 502,
          retryable: false,
          upstreamCode: "member_installation_status_invalid",
        });
      }
      span.setAttribute("control_plane.active", parsed.data.active);
      return parsed.data.active;
    },
  );
}

function parseId(value: string, field: string): string {
  const parsed = ControlPlaneIdSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new SchemaValidationError({
    field,
    clientValidated: true,
    issues: [`${field} must be a UUID`],
  });
}

function installationPath(appId: string, vaultId: string): string {
  return `/api/v1/apps/${encodeURIComponent(appId)}/installations/${encodeURIComponent(vaultId)}`;
}

function parseCommandResponse(
  body: unknown,
): Pick<ControlPlaneInstallationCommandResult, "commandStatus" | "replayed"> {
  const parsed = CommandResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new SchemaValidationError({
      issues: ["AKB installation command response was invalid"],
    });
  }
  return {
    commandStatus: parsed.data.command_status,
    replayed: parsed.data.replayed,
  };
}

function installationFromCommand(body: unknown): ControlPlaneInstallation {
  return parseControlPlaneInstallation(body);
}

export async function readInstallation(
  params: ReadInstallationParams,
): Promise<ControlPlaneInstallation> {
  const appId = parseId(params.appId, "appId");
  const vaultId = parseId(params.vaultId, "vaultId");
  return withSpan(
    "akb.control_plane.installation.get",
    {
      "control_plane.operation": "installation.get",
      "control_plane.actor_mode": "user",
      "control_plane.app_id": appId,
      "control_plane.vault_id": vaultId,
    },
    async () => {
      const body = await params.adapter.request(
        installationPath(appId, vaultId),
        {
          resource: "application installation",
        },
      );
      return parseControlPlaneInstallation(body);
    },
  );
}

async function sendInstallationCommand(
  params: RequestInstallationParams,
  releaseId: string,
  mode: "install" | "restore" | "fresh",
): Promise<ControlPlaneInstallationCommandResult> {
  const appId = parseId(params.appId, "appId");
  const vaultId = parseId(params.vaultId, "vaultId");
  const validReleaseId = parseId(releaseId, "releaseId");
  return withSpan(
    `akb.control_plane.installation.${mode}`,
    {
      "control_plane.operation": `installation.${mode}`,
      "control_plane.actor_mode": "user",
      "control_plane.app_id": appId,
      "control_plane.vault_id": vaultId,
      "control_plane.release_id": validReleaseId,
      "control_plane.capability_count": CAPABILITIES.length,
    },
    async (span) => {
      const body = await params.adapter.request(
        installationPath(appId, vaultId),
        {
          method: "PUT",
          body: {
            release_id: validReleaseId,
            capabilities: [...CAPABILITIES],
            mode,
          },
          resource: "application installation",
        },
      );
      const installation = installationFromCommand(body);
      const acknowledgement = parseCommandResponse(body);
      span.setAttribute("control_plane.lifecycle", installation.lifecycle);
      return ControlPlaneInstallationCommandResultSchema.parse({
        installation,
        ...acknowledgement,
      });
    },
  );
}

export async function requestInstallation(
  params: RequestInstallationParams,
): Promise<ControlPlaneInstallationCommandResult> {
  const mode = InstallModeSchema.parse(params.mode);
  if (mode !== "restore") {
    return sendInstallationCommand(params, params.releaseId, mode);
  }

  const existing = await readInstallation(params);
  if (existing.lifecycle !== "uninstalled") {
    throw new SchemaValidationError({
      field: "mode",
      clientValidated: true,
      issues: ["Only an uninstalled application can be restored"],
    });
  }
  const retainedReleaseId = existing.currentRelease?.id;
  if (!retainedReleaseId) {
    throw new SchemaValidationError({
      field: "releaseId",
      clientValidated: true,
      issues: ["The retained release is unavailable for restore"],
    });
  }
  return sendInstallationCommand(params, retainedReleaseId, mode);
}

export async function uninstallInstallation(
  params: ReadInstallationParams,
): Promise<ControlPlaneInstallationCommandResult> {
  const appId = parseId(params.appId, "appId");
  const vaultId = parseId(params.vaultId, "vaultId");
  return withSpan(
    "akb.control_plane.installation.uninstall",
    {
      "control_plane.operation": "installation.uninstall",
      "control_plane.actor_mode": "user",
      "control_plane.app_id": appId,
      "control_plane.vault_id": vaultId,
      "control_plane.capability_count": CAPABILITIES.length,
    },
    async (span) => {
      const body = await params.adapter.request(
        installationPath(appId, vaultId),
        {
          method: "DELETE",
          resource: "application installation",
        },
      );
      const installation = installationFromCommand(body);
      const acknowledgement = parseCommandResponse(body);
      span.setAttribute("control_plane.lifecycle", installation.lifecycle);
      return ControlPlaneInstallationCommandResultSchema.parse({
        installation,
        ...acknowledgement,
      });
    },
  );
}
