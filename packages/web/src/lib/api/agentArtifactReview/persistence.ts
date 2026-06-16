import {
  type ActivitySuggestion,
  ActivitySuggestionIdSchema,
  type AgentArtifact,
  AgentArtifactPersistenceSchema,
  AgentArtifactSchema,
  type AkbAdapter,
  NotFoundError,
  ProvenanceSchema,
  activitySuggestionId,
  akbReadActivitySuggestion,
} from "@reef/core";
import {
  type ActivitySuggestionLookup,
  AgentArtifactCommandError,
} from "./types";

export function isActivitySuggestionBackedArtifact(
  artifact: AgentArtifact,
): boolean {
  const direct = stringFromMetadata(
    artifact.metadata,
    "activity_suggestion_id",
  );
  return Boolean(direct) || expectsActivitySuggestionPersistence(artifact);
}

export async function findActivitySuggestion(
  adapter: AkbAdapter,
  vault: string,
  artifact: AgentArtifact,
): Promise<ActivitySuggestionLookup | null> {
  const directId = getExplicitActivitySuggestionId(artifact);
  const expectedPersistence = expectsActivitySuggestionPersistence(artifact);
  const derivedId = directId ?? (await deriveActivitySuggestionId(artifact));
  if (!derivedId) return null;

  try {
    const result = await akbReadActivitySuggestion({
      adapter,
      vault,
      id: derivedId,
    });
    return {
      id: derivedId,
      suggestion: result.suggestion,
      explicit: Boolean(directId),
      expectedPersistence,
    };
  } catch (err) {
    if (
      err instanceof NotFoundError ||
      (err instanceof Error && err.name === "NotFoundError")
    ) {
      return {
        id: derivedId,
        suggestion: null,
        explicit: Boolean(directId),
        expectedPersistence,
      };
    }
    throw err;
  }
}

export function shouldBlockMissingActivitySuggestion(
  lookup: ActivitySuggestionLookup,
): boolean {
  return Boolean(
    !lookup.suggestion && (lookup.explicit || lookup.expectedPersistence),
  );
}

export function markArtifact(
  artifact: AgentArtifact,
  status: "approved" | "dismissed" | "edited",
  metadata: Record<string, unknown> = {},
): AgentArtifact {
  return AgentArtifactSchema.parse({
    ...artifact,
    status,
    updated_at: new Date().toISOString(),
    metadata: {
      ...artifact.metadata,
      ...metadata,
    },
  });
}

export function withPersistence(
  artifact: AgentArtifact,
  sourceOfTruth: "client_ephemeral" | "akb_activity_suggestion",
  activitySuggestionId: string | null,
): AgentArtifact {
  return AgentArtifactSchema.parse({
    ...artifact,
    metadata: {
      ...artifact.metadata,
      persistence: AgentArtifactPersistenceSchema.parse({
        source_of_truth: sourceOfTruth,
        activity_suggestion_id: activitySuggestionId,
        retention:
          sourceOfTruth === "akb_activity_suggestion"
            ? "akb_review_history"
            : "browser_session",
      }),
    },
  });
}

export function suggestionKindMismatch(
  artifact: AgentArtifact,
  suggestion: ActivitySuggestion,
): AgentArtifactCommandError {
  return new AgentArtifactCommandError(
    "Artifact type does not match the persisted activity suggestion.",
    409,
    "activity_suggestion_kind_mismatch",
    {
      artifact_id: artifact.artifact_id,
      artifact_type: artifact.type,
      activity_suggestion_id: suggestion.id,
      suggestion_kind: suggestion.kind,
    },
  );
}

export function activitySuggestionUnavailable(
  artifact: AgentArtifact,
  lookup: ActivitySuggestionLookup,
): AgentArtifactCommandError {
  if (lookup.explicit) {
    return new AgentArtifactCommandError(
      "Artifact command could not find the referenced activity suggestion.",
      409,
      "activity_suggestion_not_found",
      {
        artifact_id: artifact.artifact_id,
        activity_suggestion_id: lookup.id,
      },
    );
  }

  if (lookup.expectedPersistence) {
    return new AgentArtifactCommandError(
      "The activity suggestion is still being persisted. Retry after the scan completes.",
      409,
      "activity_suggestion_persisting",
      {
        artifact_id: artifact.artifact_id,
        activity_suggestion_id: lookup.id,
      },
    );
  }

  return new AgentArtifactCommandError(
    "Artifact command could not find the derived activity suggestion.",
    409,
    "activity_suggestion_not_found",
    {
      artifact_id: artifact.artifact_id,
      activity_suggestion_id: lookup.id,
    },
  );
}

function expectsActivitySuggestionPersistence(
  artifact: AgentArtifact,
): boolean {
  const persistence = artifact.metadata.persistence;
  if (!persistence || typeof persistence !== "object") return false;
  const parsed = AgentArtifactPersistenceSchema.safeParse(persistence);
  return (
    parsed.success && parsed.data.source_of_truth === "akb_activity_suggestion"
  );
}

function getExplicitActivitySuggestionId(
  artifact: AgentArtifact,
): string | null {
  const direct = stringFromMetadata(
    artifact.metadata,
    "activity_suggestion_id",
  );
  if (direct) return parseActivitySuggestionId(direct, artifact);
  const persistence = artifact.metadata.persistence;
  if (!persistence || typeof persistence !== "object") return null;
  const nested = stringFromMetadata(
    persistence as Record<string, unknown>,
    "activity_suggestion_id",
  );
  return nested ? parseActivitySuggestionId(nested, artifact) : null;
}

function parseActivitySuggestionId(
  value: string,
  artifact: AgentArtifact,
): string {
  const parsed = ActivitySuggestionIdSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new AgentArtifactCommandError(
    "Artifact metadata contains an invalid activity suggestion id.",
    400,
    "invalid_activity_suggestion_id",
    { artifact_id: artifact.artifact_id },
  );
}

async function deriveActivitySuggestionId(
  artifact: AgentArtifact,
): Promise<string | null> {
  if (artifact.type === "issue_create_proposal") {
    const parsed = ProvenanceSchema.safeParse(artifact.metadata.provenance);
    if (!parsed.success) return null;
    return activitySuggestionId(
      "draft",
      `${parsed.data.repo}:${parsed.data.type}:${parsed.data.ref}`,
    );
  }

  if (artifact.type === "status_change_proposal") {
    const update = artifact.payload.proposal.update;
    const status = update.patch.status;
    const refs = artifact.payload.status_evidence
      .map((item) => `${item.repo}:${item.type}:${item.ref}`)
      .slice()
      .sort()
      .join(",");
    return activitySuggestionId(
      "status_change",
      `${update.issue_id}|${status}|${refs}`,
    );
  }

  return null;
}

function stringFromMetadata(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
