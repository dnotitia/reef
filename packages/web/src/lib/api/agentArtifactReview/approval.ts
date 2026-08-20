import {
  type AgentIssueCreateProposalArtifact,
  type AgentIssueUpdateProposalArtifact,
  type AgentStatusChangeProposalArtifact,
  akbAllocateNextIssueId,
  akbListIssues,
  akbReadIssue,
  akbUpdateIssue,
  akbWriteIssue,
  buildIssueMetadataFromCreateInput,
  buildIssueUpdateMetadataPatch,
  isForwardStatus,
} from "@reef/core";
import { markArtifact, withPersistence } from "./persistence";
import {
  AgentArtifactCommandError,
  type AgentArtifactCommandResult,
  type ApproveAgentArtifactParams,
} from "./types";

export async function approveClientIssueCreateArtifact({
  adapter,
  vault,
  actor,
  artifact,
  prefix,
}: ApproveAgentArtifactParams & {
  artifact: AgentIssueCreateProposalArtifact;
}): Promise<AgentArtifactCommandResult> {
  if (!prefix) {
    throw new AgentArtifactCommandError(
      "Project prefix is required to approve an issue-create artifact.",
      400,
      "missing_project_prefix",
      { artifact_id: artifact.artifact_id },
    );
  }

  const source = `ai-agent:artifact:${artifact.artifact_id}`;
  const existingIssue = (await akbListIssues({ adapter, vault })).issues.find(
    (issue) => issue.source === source,
  );
  if (existingIssue) {
    return {
      artifact: withPersistence(markArtifact(artifact, "approved", { source })),
      issueId: existingIssue.id,
    };
  }

  const issueId = await akbAllocateNextIssueId({ adapter, vault, prefix });
  const issue = buildIssueMetadataFromCreateInput({
    id: issueId,
    create: artifact.payload.proposal.create,
    source,
    author: actor,
  });
  await akbWriteIssue({
    adapter,
    vault,
    issue,
    content: artifact.payload.proposal.create.content,
  });
  return {
    artifact: withPersistence(markArtifact(artifact, "approved", { source })),
    issueId,
  };
}

export async function approveClientIssueUpdateArtifact({
  adapter,
  vault,
  actor,
  artifact,
}: ApproveAgentArtifactParams & {
  artifact: AgentIssueUpdateProposalArtifact;
}): Promise<AgentArtifactCommandResult> {
  const update = artifact.payload.proposal.update;
  const source = `ai-agent:artifact:${artifact.artifact_id}`;
  const result = await akbUpdateIssue({
    adapter,
    vault,
    id: update.issue_id,
    partial: buildIssueUpdateMetadataPatch({ update, actor, source }),
    ...(update.content !== undefined ? { content: update.content } : {}),
    message: `feat: approve artifact ${artifact.artifact_id} for ${update.issue_id}`,
  });
  return {
    artifact: withPersistence(markArtifact(artifact, "approved", { source })),
    issueId: update.issue_id,
    commit_hash: result.commit_hash,
  };
}

export async function approveClientStatusChangeArtifact({
  adapter,
  vault,
  actor,
  artifact,
}: ApproveAgentArtifactParams & {
  artifact: AgentStatusChangeProposalArtifact;
}): Promise<AgentArtifactCommandResult> {
  const update = artifact.payload.proposal.update;
  const toStatus = update.patch.status;
  const source = `ai-agent:artifact:${artifact.artifact_id}`;
  if (toStatus === "closed") {
    throw new AgentArtifactCommandError(
      "Closing an issue requires a reason. Close it from the issue close dialog instead.",
      400,
      "close_requires_reason",
      { artifact_id: artifact.artifact_id, issue_id: update.issue_id },
    );
  }

  const currentIssue = await akbReadIssue({
    adapter,
    vault,
    id: update.issue_id,
  });
  if (
    currentIssue.issue.status === toStatus &&
    currentIssue.issue.source === source
  ) {
    return {
      artifact: withPersistence(markArtifact(artifact, "approved", { source })),
      issueId: update.issue_id,
      commit_hash: "",
    };
  }
  if (!isForwardStatus(currentIssue.issue.status, toStatus)) {
    throw new AgentArtifactCommandError(
      "This artifact is out of date because the issue status has already changed.",
      409,
      "stale_status_change_artifact",
      {
        artifact_id: artifact.artifact_id,
        issue_id: update.issue_id,
        current_status: currentIssue.issue.status,
        target_status: toStatus,
      },
    );
  }

  const result = await akbUpdateIssue({
    adapter,
    vault,
    id: update.issue_id,
    partial: buildIssueUpdateMetadataPatch({
      update: {
        issue_id: update.issue_id,
        patch: { status: toStatus },
      },
      actor,
      source,
    }),
  });
  return {
    artifact: withPersistence(markArtifact(artifact, "approved", { source })),
    issueId: update.issue_id,
    commit_hash: result.commit_hash,
  };
}
