import {
  ConflictError,
  NotFoundError,
  SchemaLifecycleError,
} from "../../../errors";
import {
  WORKSPACE_INITIALIZATION_STATES,
  type WorkspaceInitializationMarker,
  WorkspaceInitializationMarkerSchema,
  type WorkspaceInitializationState,
} from "../../../schemas/workspace/initialization";
import {
  type AkbAdapter,
  type DocumentPutResponse,
  ensureDocumentPutResponse,
  ensureDocumentResponse,
} from "../core/shared";
import { REEF_SCHEMA_VERSION } from "../core/tableManifest";

export const REEF_INITIALIZATION_MARKER_COLLECTION = "overview";
export const REEF_INITIALIZATION_MARKER_SLUG = "reef-initialization";
export const REEF_INITIALIZATION_MARKER_PATH = `${REEF_INITIALIZATION_MARKER_COLLECTION}/${REEF_INITIALIZATION_MARKER_SLUG}.md`;

export interface StoredWorkspaceInitializationMarker {
  uri: string;
  path: string;
  currentCommit: string;
  marker: WorkspaceInitializationMarker;
}

function markerBody(marker: WorkspaceInitializationMarker): string {
  return `${JSON.stringify(marker, null, 2)}\n`;
}

function parseMarker(
  content: string | null | undefined,
  vault: string,
): WorkspaceInitializationMarker {
  try {
    const parsed = WorkspaceInitializationMarkerSchema.parse(
      JSON.parse(content ?? ""),
    );
    return parsed;
  } catch {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault,
    });
  }
}

/**
 * Advance the ready marker's workspace schema version after migration and
 * final manifest verification. The marker format is version-independent, so
 * an older workspace remains readable by the release that must migrate it.
 */
export async function updateWorkspaceInitializationSchemaVersion(
  adapter: AkbAdapter,
  vault: string,
  current: StoredWorkspaceInitializationMarker,
  schemaVersion: number,
): Promise<StoredWorkspaceInitializationMarker> {
  if (
    current.marker.state !== "ready" ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion <= current.marker.schema_version
  ) {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault,
    });
  }
  const next: WorkspaceInitializationMarker = {
    ...current.marker,
    schema_version: schemaVersion,
  };
  try {
    await adapter.request(
      `/api/v1/documents/${encodeURIComponent(vault)}/${current.path}`,
      {
        method: "PATCH",
        body: {
          content: markerBody(next),
          expected_commit: current.currentCommit,
          message: `chore(reef): advance schema to v${schemaVersion}`,
        },
        resource: `workspace initialization marker in ${vault}`,
      },
    );
  } catch (error) {
    const readback = await readWorkspaceInitializationMarker(adapter, vault);
    if (
      readback &&
      readback.marker.state === "ready" &&
      readback.marker.request_fingerprint ===
        current.marker.request_fingerprint &&
      readback.marker.schema_version >= schemaVersion
    ) {
      return readback;
    }
    throw error;
  }
  const readback = await readWorkspaceInitializationMarker(adapter, vault);
  if (
    !readback ||
    readback.marker.state !== "ready" ||
    readback.marker.request_fingerprint !==
      current.marker.request_fingerprint ||
    readback.marker.schema_version < schemaVersion
  ) {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault,
    });
  }
  return readback;
}

export async function readWorkspaceInitializationMarker(
  adapter: AkbAdapter,
  vault: string,
): Promise<StoredWorkspaceInitializationMarker | null> {
  try {
    const response = ensureDocumentResponse(
      await adapter.request(
        `/api/v1/documents/${encodeURIComponent(vault)}/${REEF_INITIALIZATION_MARKER_PATH}`,
        { resource: `workspace initialization marker in ${vault}` },
      ),
    );
    if (!response.current_commit) {
      throw new SchemaLifecycleError({
        reason: "initialization_state_invalid",
        vault,
      });
    }
    return {
      uri: response.uri,
      path: response.path,
      currentCommit: response.current_commit,
      marker: parseMarker(response.content, vault),
    };
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export async function createWorkspaceInitializationMarker(
  adapter: AkbAdapter,
  vault: string,
  requestFingerprint: string,
): Promise<StoredWorkspaceInitializationMarker> {
  const marker: WorkspaceInitializationMarker = {
    schema_version: REEF_SCHEMA_VERSION,
    state: "initializing",
    request_fingerprint: requestFingerprint,
  };
  let created: DocumentPutResponse;
  try {
    created = ensureDocumentPutResponse(
      await adapter.request("/api/v1/documents", {
        method: "POST",
        body: {
          vault,
          collection: REEF_INITIALIZATION_MARKER_COLLECTION,
          slug: REEF_INITIALIZATION_MARKER_SLUG,
          title: "Reef workspace initialization",
          type: "reference",
          status: "active",
          summary: "Durable Reef workspace initialization state",
          tags: ["reef:initialization"],
          content: markerBody(marker),
        },
        resource: `workspace initialization marker in ${vault}`,
      }),
    );
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    const concurrent = await readWorkspaceInitializationMarker(adapter, vault);
    if (!concurrent) throw error;
    return concurrent;
  }
  const readback = await readWorkspaceInitializationMarker(adapter, vault);
  if (!readback || readback.uri !== created.uri) {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault,
    });
  }
  return readback;
}

function stateRank(state: WorkspaceInitializationState): number {
  return WORKSPACE_INITIALIZATION_STATES.indexOf(state);
}

export async function advanceWorkspaceInitializationMarker(
  adapter: AkbAdapter,
  vault: string,
  current: StoredWorkspaceInitializationMarker,
  nextState: WorkspaceInitializationState,
): Promise<StoredWorkspaceInitializationMarker> {
  if (stateRank(nextState) !== stateRank(current.marker.state) + 1) {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault,
    });
  }
  const next: WorkspaceInitializationMarker = {
    ...current.marker,
    state: nextState,
  };
  try {
    await adapter.request(
      `/api/v1/documents/${encodeURIComponent(vault)}/${current.path}`,
      {
        method: "PATCH",
        body: {
          content: markerBody(next),
          expected_commit: current.currentCommit,
          message: `chore(reef): advance initialization to ${nextState}`,
        },
        resource: `workspace initialization marker in ${vault}`,
      },
    );
  } catch (error) {
    const readback = await readWorkspaceInitializationMarker(adapter, vault);
    if (
      readback &&
      readback.marker.request_fingerprint ===
        current.marker.request_fingerprint &&
      stateRank(readback.marker.state) >= stateRank(nextState)
    ) {
      return readback;
    }
    throw error;
  }
  const readback = await readWorkspaceInitializationMarker(adapter, vault);
  if (
    !readback ||
    readback.marker.request_fingerprint !==
      current.marker.request_fingerprint ||
    stateRank(readback.marker.state) < stateRank(nextState)
  ) {
    throw new SchemaLifecycleError({
      reason: "initialization_state_invalid",
      vault,
    });
  }
  return readback;
}
