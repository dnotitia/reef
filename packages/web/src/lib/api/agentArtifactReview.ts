import {
  AgentArtifactSchema,
  akbEnsureReefTables,
  akbUpdateActivitySuggestion,
  akbUpdateActivitySuggestionStatus,
} from "@reef/core";
import {
  approveActivitySuggestionArtifact,
  approveClientIssueCreateArtifact,
  approveClientIssueUpdateArtifact,
  approveClientStatusChangeArtifact,
} from "./agentArtifactReview/approval";
import {
  activitySuggestionUnavailable,
  findActivitySuggestion,
  isActivitySuggestionBackedArtifact,
  markArtifact,
  shouldBlockMissingActivitySuggestion,
  suggestionKindMismatch,
  withPersistence,
} from "./agentArtifactReview/persistence";
import {
  AgentArtifactCommandError,
  type AgentArtifactCommandResult,
  type AgentArtifactReviewContext,
  type ApproveAgentArtifactParams,
  type DismissAgentArtifactParams,
  type EditAgentArtifactParams,
} from "./agentArtifactReview/types";

export {
  AgentArtifactCommandError,
  type AgentArtifactCommandResult,
  type AgentArtifactReviewContext,
  type ApproveAgentArtifactParams,
  type DismissAgentArtifactParams,
  type EditAgentArtifactParams,
  isActivitySuggestionBackedArtifact,
};

export async function approveAgentArtifact({
  adapter,
  vault,
  actor,
  artifact,
  prefix,
}: ApproveAgentArtifactParams): Promise<AgentArtifactCommandResult> {
  await akbEnsureReefTables({ adapter, vault });
  const lookup = await findActivitySuggestion(adapter, vault, artifact);
  if (lookup?.suggestion) {
    return approveActivitySuggestionArtifact({
      adapter,
      vault,
      actor,
      artifact,
      prefix,
      suggestion: lookup.suggestion,
    });
  }

  if (lookup && shouldBlockMissingActivitySuggestion(lookup)) {
    throw activitySuggestionUnavailable(artifact, lookup);
  }

  switch (artifact.type) {
    case "issue_create_proposal":
      return approveClientIssueCreateArtifact({
        adapter,
        vault,
        actor,
        artifact,
        prefix,
      });
    case "issue_update_proposal":
      return approveClientIssueUpdateArtifact({
        adapter,
        vault,
        actor,
        artifact,
      });
    case "status_change_proposal":
      return approveClientStatusChangeArtifact({
        adapter,
        vault,
        actor,
        artifact,
      });
    default:
      throw new AgentArtifactCommandError(
        "This artifact type does not define a server-side approval mutation.",
        400,
        "artifact_type_not_approvable",
        { artifact_id: artifact.artifact_id, artifact_type: artifact.type },
      );
  }
}

export async function editAgentArtifact({
  artifact,
  patch,
  context,
}: EditAgentArtifactParams): Promise<AgentArtifactCommandResult> {
  const edited = markArtifact(artifact, "edited");
  const next = AgentArtifactSchema.parse({
    ...edited,
    ...patch,
    artifact_id: artifact.artifact_id,
    run_id: artifact.run_id,
    task_id: artifact.task_id,
    type: artifact.type,
    status: "edited",
    updated_at: edited.updated_at,
  });

  if (!context) return { artifact: next };

  await akbEnsureReefTables({
    adapter: context.adapter,
    vault: context.vault,
  });
  const lookup = await findActivitySuggestion(
    context.adapter,
    context.vault,
    artifact,
  );
  if (lookup && shouldBlockMissingActivitySuggestion(lookup)) {
    throw activitySuggestionUnavailable(next, lookup);
  }
  if (!lookup?.suggestion) return { artifact: next };
  if (lookup.suggestion.status !== "pending") {
    throw new AgentArtifactCommandError(
      "This artifact has already been reviewed.",
      409,
      "artifact_already_reviewed",
      { artifact_id: artifact.artifact_id, activity_suggestion_id: lookup.id },
    );
  }

  if (next.type === "issue_create_proposal") {
    if (lookup.suggestion.kind !== "draft") {
      throw suggestionKindMismatch(next, lookup.suggestion);
    }
    const result = await akbUpdateActivitySuggestion({
      adapter: context.adapter,
      vault: context.vault,
      id: lookup.id,
      patch: { create: next.payload.proposal.create },
    });
    return {
      artifact: withPersistence(next, "akb_activity_suggestion", lookup.id),
      suggestion: result.suggestion,
    };
  }

  if (next.type === "status_change_proposal") {
    if (lookup.suggestion.kind !== "status_change") {
      throw suggestionKindMismatch(next, lookup.suggestion);
    }
    const currentUpdate = lookup.suggestion.proposal.update;
    const nextUpdate = next.payload.proposal.update;
    const nextStatus = nextUpdate.patch.status;
    if (nextUpdate.issue_id !== currentUpdate.issue_id) {
      throw new AgentArtifactCommandError(
        "Status-change artifacts cannot retarget the issue.",
        400,
        "status_change_retarget_forbidden",
        {
          artifact_id: artifact.artifact_id,
          activity_suggestion_id: lookup.id,
          issue_id: currentUpdate.issue_id,
          attempted_issue_id: nextUpdate.issue_id,
        },
      );
    }
    if (nextStatus === "closed") {
      throw new AgentArtifactCommandError(
        "Closing an issue requires a reason. Close it from the issue close dialog instead.",
        400,
        "close_requires_reason",
        { artifact_id: artifact.artifact_id, issue_id: currentUpdate.issue_id },
      );
    }
    // `backlog` is rank 0: approval's forward-moving guard can not accept it, so
    // a backlog target should be rejected here rather than persisted into an
    // unapprovable suggestion — mirroring the activity-suggestion edit boundary
    // (REEF-109).
    if (nextStatus === "backlog") {
      throw new AgentArtifactCommandError(
        "Backlog isn't a valid status-change target. Move an issue to the backlog from the issue itself.",
        400,
        "invalid_status_change_target",
        { artifact_id: artifact.artifact_id, issue_id: currentUpdate.issue_id },
      );
    }
    const result = await akbUpdateActivitySuggestion({
      adapter: context.adapter,
      vault: context.vault,
      id: lookup.id,
      patch: {
        update: {
          issue_id: currentUpdate.issue_id,
          patch: { status: nextStatus },
        },
        rationale: next.payload.rationale,
      },
    });
    return {
      artifact: withPersistence(next, "akb_activity_suggestion", lookup.id),
      suggestion: result.suggestion,
    };
  }

  return { artifact: next };
}

export async function dismissAgentArtifact({
  artifact,
  context,
}: DismissAgentArtifactParams): Promise<AgentArtifactCommandResult> {
  if (context) {
    await akbEnsureReefTables({
      adapter: context.adapter,
      vault: context.vault,
    });
    const lookup = await findActivitySuggestion(
      context.adapter,
      context.vault,
      artifact,
    );
    if (lookup && shouldBlockMissingActivitySuggestion(lookup)) {
      throw activitySuggestionUnavailable(artifact, lookup);
    }
    if (lookup?.suggestion) {
      if (lookup.suggestion.status !== "pending") {
        throw new AgentArtifactCommandError(
          "This artifact has already been reviewed.",
          409,
          "artifact_already_reviewed",
          {
            artifact_id: artifact.artifact_id,
            activity_suggestion_id: lookup.id,
          },
        );
      }
      const result = await akbUpdateActivitySuggestionStatus({
        adapter: context.adapter,
        vault: context.vault,
        id: lookup.id,
        status: "dismissed",
        reviewed_by: context.actor,
      });
      return {
        artifact: withPersistence(
          markArtifact(artifact, "dismissed"),
          "akb_activity_suggestion",
          lookup.id,
        ),
        suggestion: result.suggestion,
      };
    }
  }

  return {
    artifact: withPersistence(
      markArtifact(artifact, "dismissed"),
      "client_ephemeral",
      null,
    ),
  };
}
