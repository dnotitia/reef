import { SchemaLifecycleError } from "../../../errors";
import {
  type Config,
  ConfigSchema,
  type MonitoredRepo,
} from "../../../schemas/workspace/config";
import {
  WORKSPACE_INITIALIZATION_STATES,
  type WorkspaceInitializationResult,
  type WorkspaceInitializationState,
} from "../../../schemas/workspace/initialization";
import type { AkbAdapter } from "../core/http";
import {
  reconcileWorkspaceSchema,
  verifyWorkspaceSchema,
} from "../core/tables";
import {
  getVaultSkillStatus,
  installReefVaultSkillDocuments,
  stampReefVaultSkillVersion,
} from "../vaultSkill/vaultSkill";
import { readConfig, writeInitialConfig } from "./config";
import {
  type StoredWorkspaceInitializationMarker,
  advanceWorkspaceInitializationMarker,
  createWorkspaceInitializationMarker,
  readWorkspaceInitializationMarker,
} from "./initializationMarker";
import {
  createVault,
  grantVaultMember,
  listVaultMembers,
  listVaults,
} from "./vaults";

export interface InitializeWorkspaceParams {
  adapter: AkbAdapter;
  request: {
    name: string;
    description?: string;
    config: Config;
  };
  serviceUsername: string;
}

function normalizeRepos(repos: readonly MonitoredRepo[]): MonitoredRepo[] {
  return [...repos]
    .map((repo) => ({ ...repo }))
    .sort(
      (left, right) =>
        left.github_id - right.github_id ||
        left.owner.localeCompare(right.owner) ||
        left.name.localeCompare(right.name),
    );
}

function canonicalInitializationRequest(name: string, config: Config): string {
  const normalized = ConfigSchema.parse(config);
  return JSON.stringify({
    name,
    config: {
      ...normalized,
      monitored_repos: normalizeRepos(normalized.monitored_repos),
    },
  });
}

export async function workspaceInitializationFingerprint(
  name: string,
  config: Config,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    canonicalInitializationRequest(name, config),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function configsEqual(left: Config, right: Config): boolean {
  return (
    canonicalInitializationRequest("workspace", left) ===
    canonicalInitializationRequest("workspace", right)
  );
}

function hasReached(
  stored: StoredWorkspaceInitializationMarker,
  state: WorkspaceInitializationState,
): boolean {
  return (
    WORKSPACE_INITIALIZATION_STATES.indexOf(stored.marker.state) >=
    WORKSPACE_INITIALIZATION_STATES.indexOf(state)
  );
}

async function verifyDurableProgress(
  adapter: AkbAdapter,
  vault: string,
  stored: StoredWorkspaceInitializationMarker,
): Promise<void> {
  if (hasReached(stored, "schema_provisioned")) {
    await verifyWorkspaceSchema({ adapter, vault });
  }
  if (hasReached(stored, "skill_installed")) {
    const skill = await getVaultSkillStatus({ adapter, vault });
    if (!skill.up_to_date) {
      throw new SchemaLifecycleError({
        reason: "initialization_state_invalid",
        vault,
      });
    }
  }
  if (stored.marker.state === "ready") {
    const config = await readConfig({ adapter, vault });
    if (!config.exists) {
      throw new SchemaLifecycleError({
        reason: "initialization_state_invalid",
        vault,
      });
    }
  }
}

async function exactWriterExists(
  adapter: AkbAdapter,
  vault: string,
  serviceUsername: string,
): Promise<boolean> {
  const { members } = await listVaultMembers({ adapter, vault });
  const exact = members.filter((member) => member.username === serviceUsername);
  return exact.length === 1 && exact[0]?.role === "writer";
}

async function ensureExactWriterMembership(
  adapter: AkbAdapter,
  vault: string,
  serviceUsername: string,
): Promise<void> {
  if (await exactWriterExists(adapter, vault, serviceUsername)) return;
  try {
    await grantVaultMember({
      adapter,
      vault,
      user: serviceUsername,
      role: "writer",
    });
  } catch (error) {
    if (!(await exactWriterExists(adapter, vault, serviceUsername))) {
      throw error;
    }
  }
  if (!(await exactWriterExists(adapter, vault, serviceUsername))) {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault,
    });
  }
}

async function ensureRawVault(
  adapter: AkbAdapter,
  name: string,
  description: string | undefined,
): Promise<void> {
  const initial = await listVaults({ adapter });
  if (initial.vaults.some((vault) => vault.name === name)) return;
  try {
    await createVault({ adapter, name, description });
  } catch (error) {
    const readback = await listVaults({ adapter });
    if (readback.vaults.some((vault) => vault.name === name)) return;
    throw error;
  }
}

/** Explicit schema lifecycle owner for a newly configured workspace. */
export async function initializeWorkspace(
  params: InitializeWorkspaceParams,
): Promise<WorkspaceInitializationResult> {
  const { adapter } = params;
  const serviceUsername = params.serviceUsername.trim();
  const { name, description } = params.request;
  if (!serviceUsername) {
    throw new SchemaLifecycleError({ reason: "migration_config_invalid" });
  }
  const config = ConfigSchema.parse(params.request.config);
  const fingerprint = await workspaceInitializationFingerprint(name, config);

  await ensureRawVault(adapter, name, description);
  let stored = await readWorkspaceInitializationMarker(adapter, name);
  if (!stored) {
    const existingConfig = await readConfig({ adapter, vault: name });
    if (existingConfig.exists) {
      throw new SchemaLifecycleError({
        reason: "initialization_conflict",
        vault: name,
      });
    }
    stored = await createWorkspaceInitializationMarker(
      adapter,
      name,
      fingerprint,
    );
  }
  if (stored.marker.request_fingerprint !== fingerprint) {
    throw new SchemaLifecycleError({
      reason: "initialization_conflict",
      vault: name,
    });
  }

  // Membership is durable lifecycle state, not merely an initializing-stage
  // side effect. Restore/recheck it on every replay before later stages can
  // advance, including a ready retry after an operator removed the grant.
  await ensureExactWriterMembership(adapter, name, serviceUsername);
  await verifyDurableProgress(adapter, name, stored);

  if (stored.marker.state === "initializing") {
    stored = await advanceWorkspaceInitializationMarker(
      adapter,
      name,
      stored,
      "writer_registered",
    );
    await verifyDurableProgress(adapter, name, stored);
  }

  if (stored.marker.state === "writer_registered") {
    await reconcileWorkspaceSchema({ adapter, vault: name });
    await verifyWorkspaceSchema({ adapter, vault: name });
    stored = await advanceWorkspaceInitializationMarker(
      adapter,
      name,
      stored,
      "schema_provisioned",
    );
    await verifyDurableProgress(adapter, name, stored);
  }

  if (stored.marker.state === "schema_provisioned") {
    await installReefVaultSkillDocuments({ adapter, vault: name });
    await stampReefVaultSkillVersion(adapter, name);
    const skill = await getVaultSkillStatus({ adapter, vault: name });
    if (!skill.up_to_date) {
      throw new SchemaLifecycleError({
        reason: "initialization_state_invalid",
        vault: name,
      });
    }
    stored = await advanceWorkspaceInitializationMarker(
      adapter,
      name,
      stored,
      "skill_installed",
    );
    await verifyDurableProgress(adapter, name, stored);
  }

  if (stored.marker.state === "skill_installed") {
    await writeInitialConfig({
      adapter,
      vault: name,
      config,
      fingerprint,
    });
    const configReadback = await readConfig({ adapter, vault: name });
    if (
      !configReadback.exists ||
      !configsEqual(configReadback.config, config)
    ) {
      throw new SchemaLifecycleError({
        reason: "initialization_state_invalid",
        vault: name,
      });
    }
    await ensureExactWriterMembership(adapter, name, serviceUsername);
    stored = await advanceWorkspaceInitializationMarker(
      adapter,
      name,
      stored,
      "ready",
    );
    await verifyDurableProgress(adapter, name, stored);
  }

  const configReadback = await readConfig({ adapter, vault: name });
  if (
    stored.marker.state !== "ready" ||
    !configReadback.exists ||
    !(await exactWriterExists(adapter, name, serviceUsername))
  ) {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault: name,
    });
  }
  await verifyWorkspaceSchema({ adapter, vault: name });

  return {
    name,
    config: configReadback.config,
    state: "ready",
    marker_uri: stored.uri,
  };
}

export async function isWorkspaceInitializationReady(
  adapter: AkbAdapter,
  vault: string,
): Promise<boolean> {
  const marker = await readWorkspaceInitializationMarker(adapter, vault);
  return marker?.marker.state === "ready";
}
