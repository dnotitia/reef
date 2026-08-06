import type {
  PendingDraft,
  PendingStatusChange,
  StatusChangeEvidence,
} from "../../schemas/activity/pendingDraft";
import type { ImplementationRef } from "../../schemas/issues/metadata";
import type { PlanningCatalog } from "../../schemas/planning/catalog";
import type { AgentArtifact } from "../framework/events";
import {
  AgentIssueCreateProposalArtifactSchema,
  AgentStatusChangeProposalArtifactSchema,
} from "../framework/events";
import type { NormalisedActivity } from "./types";

export interface ActivityArtifactContext {
  run_id: string;
  task_id: string;
}

export function implementationRefsForActivity(
  activity: NormalisedActivity,
  detectedAt: string,
): ImplementationRef[] {
  if (activity.type === "pr") {
    const pr = activity.draftPromptRequest.activity.pr;
    return [
      {
        type: "pull_request",
        repo: activity.repo,
        ref: activity.ref,
        ...(pr?.title ? { title: pr.title } : {}),
        actor: activity.actor,
        detected_at: detectedAt,
        url: `https://github.com/${activity.repo}/pull/${activity.ref}`,
      },
      ...(pr?.headBranch
        ? [
            {
              type: "branch" as const,
              repo: activity.repo,
              ref: pr.headBranch,
              actor: activity.actor,
              detected_at: detectedAt,
            },
          ]
        : []),
    ];
  }

  const commit = activity.draftPromptRequest.activity.commit;
  return [
    {
      type: "commit",
      repo: activity.repo,
      ref: activity.ref,
      title: commit?.message.split("\n")[0],
      actor: activity.actor,
      detected_at: detectedAt,
      url: `https://github.com/${activity.repo}/commit/${activity.ref}`,
    },
    ...(commit?.branch && commit.branch !== "default"
      ? [
          {
            type: "branch" as const,
            repo: activity.repo,
            ref: commit.branch,
            actor: activity.actor,
            detected_at: detectedAt,
          },
        ]
      : []),
  ];
}

/**
 * Map a status-change suggestion's stored evidence to delivery refs, the way the
 * draft path maps a NormalisedActivity via `implementationRefsForActivity`. The
 * status-change evidence is leaner — `{ type, repo, ref, actor }` with no branch
 * info — so this emits `pull_request` / `commit` refs (no `branch`), per the
 * runbook's "Approve a status change" mapping. `detectedAt` is the scan-level
 * timestamp carried onto every ref.
 */
export function implementationRefsFromStatusEvidence(
  evidence: readonly StatusChangeEvidence[],
  detectedAt: string,
): ImplementationRef[] {
  return evidence.map((item) => {
    const isPr = item.type === "pr";
    return {
      type: isPr ? "pull_request" : "commit",
      repo: item.repo,
      ref: item.ref,
      actor: item.actor,
      detected_at: detectedAt,
      url: isPr
        ? `https://github.com/${item.repo}/pull/${item.ref}`
        : `https://github.com/${item.repo}/commit/${item.ref}`,
    };
  });
}

function implementationRefKey(
  ref: Pick<ImplementationRef, "type" | "repo" | "ref">,
): string {
  return `${ref.type}:${ref.repo ?? ""}:${ref.ref}`;
}

/**
 * Merge `incoming` delivery refs into `existing`, de-duplicating on
 * `type:repo:ref` so re-approving or re-scanning the same activity does not doubles
 * an entry, and leaving any unrelated refs already on the issue untouched.
 */
export function mergeImplementationRefs(
  existing: readonly ImplementationRef[] | undefined,
  incoming: readonly ImplementationRef[],
): ImplementationRef[] {
  const merged: ImplementationRef[] = [...(existing ?? [])];
  const seen = new Set(merged.map(implementationRefKey));
  for (const ref of incoming) {
    const key = implementationRefKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ref);
  }
  return merged;
}

export function draftToAgentArtifact(
  draft: PendingDraft,
  { run_id, task_id }: ActivityArtifactContext,
): AgentArtifact {
  return AgentIssueCreateProposalArtifactSchema.parse({
    artifact_id: `${run_id}:draft:${draft.id}`,
    run_id,
    task_id,
    type: "issue_create_proposal",
    status: "pending",
    title: draft.proposal.create.fields.title,
    confidence: draft.confidence,
    reasoning: draft.reasoning,
    evidence: [
      {
        type: draft.provenance.type,
        ref: draft.provenance.ref,
        label: draft.provenance.repo,
        metadata: {
          actor: draft.provenance.actor,
          detectedAt: draft.provenance.detectedAt,
        },
      },
    ],
    warnings: [],
    created_at: draft.createdAt,
    updated_at: null,
    metadata: {
      persistence: {
        source_of_truth: "akb_activity_suggestion",
        activity_suggestion_id: null,
        retention: "akb_review_history",
      },
      provenance: draft.provenance,
    },
    payload: {
      proposal: draft.proposal,
    },
  });
}

export function statusChangeToAgentArtifact(
  statusChange: PendingStatusChange,
  { run_id, task_id }: ActivityArtifactContext,
): AgentArtifact {
  const toStatus = statusChange.proposal.update.patch.status;
  return AgentStatusChangeProposalArtifactSchema.parse({
    artifact_id: `${run_id}:status-change:${statusChange.id}`,
    run_id,
    task_id,
    type: "status_change_proposal",
    status: "pending",
    title: statusChange.issueTitle,
    confidence: statusChange.confidence,
    reasoning: statusChange.rationale,
    evidence: statusChange.evidence.map((item) => ({
      type: item.type,
      ref: item.ref,
      label: item.repo,
      metadata: { actor: item.actor },
    })),
    warnings: [],
    created_at: statusChange.createdAt,
    updated_at: null,
    metadata: {
      persistence: {
        source_of_truth: "akb_activity_suggestion",
        activity_suggestion_id: null,
        retention: "akb_review_history",
      },
      detectedAt: statusChange.detectedAt,
    },
    payload: {
      proposal: statusChange.proposal,
      from_status: statusChange.fromStatus,
      to_status: toStatus,
      rationale: statusChange.rationale,
      status_evidence: statusChange.evidence,
    },
  });
}

function validDateOrUndefined(value: string | undefined): string | undefined {
  return value && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

export function activityDateForDraft(
  activity: NormalisedActivity,
): string | undefined {
  if (activity.type === "pr") {
    const pr = activity.draftPromptRequest.activity.pr;
    return validDateOrUndefined(
      pr?.mergedAt ?? pr?.createdAt ?? pr?.updatedAt ?? undefined,
    );
  }
  const commit = activity.draftPromptRequest.activity.commit;
  return validDateOrUndefined(
    commit?.committedDate ?? commit?.authoredDate ?? undefined,
  );
}

export function safeIsoDate(value: string | undefined): string | undefined {
  return validDateOrUndefined(value);
}

export function planningIdSets(catalog: PlanningCatalog | undefined): {
  milestoneIds: ReadonlySet<string>;
  sprintIds: ReadonlySet<string>;
  releaseIds: ReadonlySet<string>;
} | null {
  if (!catalog) return null;
  return {
    milestoneIds: new Set(catalog.milestones.map((item) => item.id)),
    sprintIds: new Set(catalog.sprints.map((item) => item.id)),
    releaseIds: new Set(catalog.releases.map((item) => item.id)),
  };
}
