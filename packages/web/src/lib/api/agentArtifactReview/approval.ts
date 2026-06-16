import {
  type ActivitySuggestion,
  type AgentIssueCreateProposalArtifact,
  type AgentIssueUpdateProposalArtifact,
  type AgentStatusChangeProposalArtifact,
  akbAllocateNextIssueId,
  akbListIssues,
  akbReadIssue,
  akbUpdateActivitySuggestionStatus,
  akbUpdateIssue,
  akbWriteIssue,
  buildIssueMetadataFromCreateInput,
  buildIssueUpdateMetadataPatch,
  isForwardStatus,
  withRecoveredDraftStatus,
} from "@reef/core";
import {
  markArtifact,
  suggestionKindMismatch,
  withPersistence,
} from "./persistence";
import {
  AgentArtifactCommandError,
  type AgentArtifactCommandResult,
  type ApproveAgentArtifactParams,
} from "./types";

export async function approveActivitySuggestionArtifact({
  adapter,
  vault,
  actor,
  artifact,
  prefix,
  suggestion,
}: ApproveAgentArtifactParams & {
  suggestion: ActivitySuggestion;
}): Promise<AgentArtifactCommandResult> {
  if (suggestion.status === "dismissed") {
    throw new AgentArtifactCommandError(
      "This artifact has already been dismissed.",
      409,
      "artifact_already_dismissed",
      {
        artifact_id: artifact.artifact_id,
        activity_suggestion_id: suggestion.id,
      },
    );
  }

  if (suggestion.kind === "draft") {
    if (artifact.type !== "issue_create_proposal") {
      throw suggestionKindMismatch(artifact, suggestion);
    }
    const source = `ai-agent:create_issue:${suggestion.id}`;
    const legacySource = `ai-agent:draft_issue:${suggestion.id}`;
    const existingIssue = (await akbListIssues({ adapter, vault })).issues.find(
      (issue) => issue.source === source || issue.source === legacySource,
    );
    if (existingIssue) {
      const updated = await akbUpdateActivitySuggestionStatus({
        adapter,
        vault,
        id: suggestion.id,
        status: "approved",
        reviewed_by: actor,
        approved_issue_id: existingIssue.id,
      });
      return {
        artifact: withPersistence(
          markArtifact(artifact, "approved", { source }),
          "akb_activity_suggestion",
          suggestion.id,
        ),
        suggestion: updated.suggestion,
        issueId: existingIssue.id,
      };
    }
    if (suggestion.status === "approved" && suggestion.approved_issue_id) {
      return {
        artifact: withPersistence(
          markArtifact(artifact, "approved", { source }),
          "akb_activity_suggestion",
          suggestion.id,
        ),
        suggestion,
        issueId: suggestion.approved_issue_id,
      };
    }
    if (!prefix) {
      throw new AgentArtifactCommandError(
        "Project prefix is required to approve an issue-create artifact.",
        400,
        "missing_project_prefix",
        { artifact_id: artifact.artifact_id },
      );
    }

    const issueId = await akbAllocateNextIssueId({ adapter, vault, prefix });
    const issue = buildIssueMetadataFromCreateInput({
      id: issueId,
      // Recover a code-signal status for a status-less draft so in-flight work
      // isn't dropped into the `backlog` default — mirrors the core
      // approveActivitySuggestion path (REEF-130).
      create: withRecoveredDraftStatus(
        suggestion.proposal.create,
        suggestion.provenance.type,
      ),
      source,
      author: actor,
    });
    await akbWriteIssue({
      adapter,
      vault,
      issue,
      content: suggestion.proposal.create.content,
    });
    const updated = await akbUpdateActivitySuggestionStatus({
      adapter,
      vault,
      id: suggestion.id,
      status: "approved",
      reviewed_by: actor,
      approved_issue_id: issueId,
    });
    return {
      artifact: withPersistence(
        markArtifact(artifact, "approved", { source }),
        "akb_activity_suggestion",
        suggestion.id,
      ),
      suggestion: updated.suggestion,
      issueId,
    };
  }

  if (artifact.type !== "status_change_proposal") {
    throw suggestionKindMismatch(artifact, suggestion);
  }
  if (suggestion.status === "approved") {
    return {
      artifact: withPersistence(
        markArtifact(artifact, "approved", {
          source: `ai-agent:status_change:${suggestion.id}`,
        }),
        "akb_activity_suggestion",
        suggestion.id,
      ),
      suggestion,
      issueId: suggestion.proposal.update.issue_id,
      commit_hash: "",
    };
  }

  const source = `ai-agent:status_change:${suggestion.id}`;
  const update = suggestion.proposal.update;
  const toStatus = update.patch.status;
  if (!toStatus) {
    throw new AgentArtifactCommandError(
      "Status-change artifact is missing patch.status.",
      400,
      "missing_status_patch",
      { artifact_id: artifact.artifact_id },
    );
  }
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
    const updated = await akbUpdateActivitySuggestionStatus({
      adapter,
      vault,
      id: suggestion.id,
      status: "approved",
      reviewed_by: actor,
    });
    return {
      artifact: withPersistence(
        markArtifact(artifact, "approved", { source }),
        "akb_activity_suggestion",
        suggestion.id,
      ),
      suggestion: updated.suggestion,
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

  const updateResult = await akbUpdateIssue({
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
  const updated = await akbUpdateActivitySuggestionStatus({
    adapter,
    vault,
    id: suggestion.id,
    status: "approved",
    reviewed_by: actor,
  });
  return {
    artifact: withPersistence(
      markArtifact(artifact, "approved", { source }),
      "akb_activity_suggestion",
      suggestion.id,
    ),
    suggestion: updated.suggestion,
    issueId: update.issue_id,
    commit_hash: updateResult.commit_hash,
  };
}

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
      artifact: markArtifact(artifact, "approved", { source }),
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
    artifact: withPersistence(
      markArtifact(artifact, "approved", { source }),
      "client_ephemeral",
      null,
    ),
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
    artifact: withPersistence(
      markArtifact(artifact, "approved", { source }),
      "client_ephemeral",
      null,
    ),
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
      artifact: markArtifact(artifact, "approved", { source }),
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
    artifact: withPersistence(
      markArtifact(artifact, "approved", { source }),
      "client_ephemeral",
      null,
    ),
    issueId: update.issue_id,
    commit_hash: result.commit_hash,
  };
}
