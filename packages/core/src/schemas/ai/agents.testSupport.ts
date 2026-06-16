import {
  AgentArtifactPersistenceSchema,
  AgentArtifactSchema,
  AgentArtifactStatusEnum,
  AgentArtifactTypeEnum,
  AgentRunEnvelopeSchema,
  AgentRunEventSchema,
  AgentRunEventTypeEnum,
  AgentRunStatusEnum,
} from "./agents";

export const timestamp = "2026-06-04T00:00:00.000Z";

export const baseArtifact = {
  artifact_id: "artifact-1",
  run_id: "run-1",
  task_id: "issue.enrichment",
  status: "pending",
  created_at: timestamp,
} as const;
