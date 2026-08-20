import {
  type AgentArtifact,
  AgentArtifactPersistenceSchema,
  AgentArtifactSchema,
} from "@reef/core";

export function markArtifact(
  artifact: AgentArtifact,
  status: "approved" | "dismissed" | "edited",
  metadata: Record<string, unknown> = {},
): AgentArtifact {
  return AgentArtifactSchema.parse({
    ...artifact,
    status,
    updated_at: new Date().toISOString(),
    metadata: { ...artifact.metadata, ...metadata },
  });
}

/** Every reviewed artifact remains client-ephemeral; no AKB suggestion store exists. */
export function withPersistence(artifact: AgentArtifact): AgentArtifact {
  return AgentArtifactSchema.parse({
    ...artifact,
    metadata: {
      ...artifact.metadata,
      persistence: AgentArtifactPersistenceSchema.parse({
        source_of_truth: "client_ephemeral",
        retention: "browser_session",
      }),
    },
  });
}
