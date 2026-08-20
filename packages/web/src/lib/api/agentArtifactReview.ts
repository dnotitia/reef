import { AgentArtifactSchema, akbEnsureReefTables } from "@reef/core";
import {
  approveClientIssueCreateArtifact,
  approveClientIssueUpdateArtifact,
  approveClientStatusChangeArtifact,
} from "./agentArtifactReview/approval";
import {
  markArtifact,
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
};

export async function approveAgentArtifact({
  adapter,
  vault,
  actor,
  artifact,
  prefix,
}: ApproveAgentArtifactParams): Promise<AgentArtifactCommandResult> {
  await akbEnsureReefTables({ adapter, vault });

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

export function editAgentArtifact({
  artifact,
  patch,
}: EditAgentArtifactParams): AgentArtifactCommandResult {
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
  return { artifact: withPersistence(next) };
}

export function dismissAgentArtifact({
  artifact,
}: DismissAgentArtifactParams): AgentArtifactCommandResult {
  return {
    artifact: withPersistence(markArtifact(artifact, "dismissed")),
  };
}
