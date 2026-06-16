import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { AkbAdapter } from "../adapters/akb";
import type { GitHubAdapter } from "../adapters/github";
import type { LlmAdapter } from "../adapters/llm";
import type {
  PendingDraft,
  PendingStatusChange,
} from "../schemas/activity/pendingDraft";
import {
  fetchIssueTemplateContext,
  fetchPlanningCatalogContext,
} from "./activityScan/context";
import { generateDraftForActivity } from "./activityScan/draftGeneration";
import {
  ensureLinkedIssueExists,
  generateIssueLinkForActivity,
} from "./activityScan/issueLink";
import { buildIssueIdRegex, normalizeIssueRef } from "./activityScan/issueRefs";
import { normalizeActivities } from "./activityScan/normalize";
import { generateStatusChangeForIssue } from "./activityScan/statusChange";
import {
  type NormalisedActivity,
  RECENT_COMMITS_QUERY,
  RECENT_PRS_QUERY,
  type RecentCommitsResult,
  type RecentPrsResult,
  SEMANTIC_LINK_CONFIDENCE_THRESHOLD,
} from "./activityScan/types";
import type { AgentRunEvent } from "./framework/events";
import { buildActivityIssueLinkSystemPrompt } from "./prompts/activityIssueLink";
import { buildAutoIssueSystemPrompt } from "./prompts/autoIssue";
import { buildStatusRationaleSystemPrompt } from "./prompts/statusRationale";

const tracer = trace.getTracer("@reef/core");

export interface ScanActivityParams {
  /** GitHub adapter — scans the monitored repo's commits/PRs via GraphQL. */
  adapter: GitHubAdapter;
  /** akb adapter — reads existing reef issues for dedup + per-issue titles. */
  akbAdapter: AkbAdapter;
  vault: string;
  llmAdapter: LlmAdapter;
  owner: string;
  repo: string;
  /**
   * ISO 8601 watermark. When undefined, the GraphQL history query is not
   * constrained by `since` and PR filtering is skipped — first-scan branch.
   */
  since?: string;
  projectPrefix: string;
  /**
   * Workspace default authoring language (REEF-136). When set, generated draft
   * titles/bodies and status rationales are written in it. The route reads it
   * from config and passes it; undefined/null preserves the prior model-default
   * behavior. Issue-link decisioning emits no prose, so it does not take it.
   */
  authoringLanguage?: string | null;
  /**
   * Previously-dismissed provenance refs (commit SHAs or PR numbers as
   * strings). Activity whose ref appears here is skipped before any LLM call.
   * Applied to both draft and status-change branches.
   */
  dismissedRefs?: readonly string[];
  /**
   * Optional event sink for callers that want streaming scan progress and
   * generated artifacts without changing the persisted inbox payload shape.
   */
  onEvent?: (event: AgentRunEvent) => void | Promise<void>;
}

export interface ScanActivityResult {
  drafts: PendingDraft[];
  statusChanges: PendingStatusChange[];
}

export async function scanActivity(
  params: ScanActivityParams,
): Promise<ScanActivityResult> {
  const {
    adapter,
    akbAdapter,
    vault,
    llmAdapter,
    owner,
    repo,
    since,
    projectPrefix,
    authoringLanguage,
    dismissedRefs,
    onEvent,
  } = params;
  const repoFull = `${owner}/${repo}`;
  const issueIdRegex = buildIssueIdRegex(projectPrefix);
  const dismissedSet = new Set<string>(dismissedRefs ?? []);
  // Generated drafts and status rationales are written in the workspace's
  // authoring language when set (REEF-136); issue-link decisioning emits no
  // prose, so it does not take the directive.
  const draftSystemPrompt = buildAutoIssueSystemPrompt(
    projectPrefix,
    authoringLanguage,
  );
  const linkSystemPrompt = buildActivityIssueLinkSystemPrompt(projectPrefix);
  const rationaleSystemPrompt =
    buildStatusRationaleSystemPrompt(authoringLanguage);

  return tracer.startActiveSpan(
    "reef.agent.scanActivity",
    async (parentSpan) => {
      parentSpan.setAttribute("repo", repoFull);
      parentSpan.setAttribute("since", since ?? "(first-scan)");

      try {
        const [commitsResult, prsResult, issueTemplates, planningCatalog] =
          await Promise.all([
            adapter.graphql<RecentCommitsResult>(RECENT_COMMITS_QUERY, {
              owner,
              repo,
              since: since ?? null,
            }),
            adapter.graphql<RecentPrsResult>(RECENT_PRS_QUERY, { owner, repo }),
            fetchIssueTemplateContext(akbAdapter, vault, parentSpan),
            fetchPlanningCatalogContext(akbAdapter, vault, parentSpan),
          ]);

        const commitNodes =
          commitsResult.repository.defaultBranchRef?.target?.history?.nodes ??
          [];
        const prNodes = since
          ? prsResult.repository.pullRequests.nodes.filter(
              (pr) => new Date(pr.updatedAt) >= new Date(since),
            )
          : prsResult.repository.pullRequests.nodes;

        parentSpan.setAttribute("commits_scanned", commitNodes.length);
        parentSpan.setAttribute("prs_scanned", prNodes.length);

        const activities = normalizeActivities({
          commitNodes,
          prNodes,
          dismissedRefs: dismissedSet,
          issueIdRegex,
          issueTemplates,
          planningCatalog,
          repoFull,
        });

        await linkActivities({
          activities,
          akbAdapter,
          vault,
          llmAdapter,
          linkSystemPrompt,
          projectPrefix,
          onEvent,
          setAttribute: (key, value) => parentSpan.setAttribute(key, value),
        });

        const untracked = activities.filter((a) => a.issueRef === null);
        const trackedByIssue = groupTrackedActivities(activities);

        parentSpan.setAttribute("untracked_count", untracked.length);
        parentSpan.setAttribute("tracked_issue_count", trackedByIssue.size);

        const detectedAt = new Date().toISOString();
        const drafts: PendingDraft[] = [];
        for (const activity of untracked) {
          const draft = await generateDraftForActivity({
            activity,
            llmAdapter,
            akbAdapter,
            vault,
            systemPrompt: draftSystemPrompt,
            repoFull,
            detectedAt,
            onEvent,
          });
          if (draft !== null) drafts.push(draft);
        }

        const statusChanges: PendingStatusChange[] = [];
        for (const [issueRef, bucket] of trackedByIssue) {
          const statusChange = await generateStatusChangeForIssue({
            issueRef,
            bucket,
            akbAdapter,
            vault,
            llmAdapter,
            systemPrompt: rationaleSystemPrompt,
            detectedAt,
            onEvent,
          });
          if (statusChange !== null) statusChanges.push(statusChange);
        }

        parentSpan.setAttribute("drafts_generated", drafts.length);
        parentSpan.setAttribute(
          "status_changes_generated",
          statusChanges.length,
        );
        parentSpan.setStatus({ code: SpanStatusCode.OK });
        return { drafts, statusChanges };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        parentSpan.recordException(error);
        parentSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw err;
      } finally {
        parentSpan.end();
      }
    },
  );
}

async function linkActivities({
  activities,
  akbAdapter,
  vault,
  llmAdapter,
  linkSystemPrompt,
  projectPrefix,
  onEvent,
  setAttribute,
}: {
  activities: NormalisedActivity[];
  akbAdapter: AkbAdapter;
  vault: string;
  llmAdapter: LlmAdapter;
  linkSystemPrompt: string;
  projectPrefix: string;
  onEvent?: ScanActivityParams["onEvent"];
  setAttribute: (key: string, value: string | number | boolean) => void;
}): Promise<void> {
  let semanticLinkAttempted = 0;
  let semanticLinkLinked = 0;
  let semanticLinkPossible = 0;
  let semanticLinkNoLink = 0;

  for (const activity of activities) {
    if (activity.issueRef !== null) continue;
    semanticLinkAttempted++;
    const decision = await generateIssueLinkForActivity({
      activity,
      akbAdapter,
      vault,
      llmAdapter,
      systemPrompt: linkSystemPrompt,
      projectPrefix,
      onEvent,
    });
    if (!decision) {
      semanticLinkNoLink++;
      continue;
    }
    if (decision.decision === "possible_link") {
      semanticLinkPossible++;
    } else if (decision.decision === "no_link") {
      semanticLinkNoLink++;
    }
    const linkedIssueRef = decision.issue_id
      ? normalizeIssueRef(decision.issue_id, projectPrefix)
      : null;
    if (
      decision.decision !== "linked" ||
      decision.confidence < SEMANTIC_LINK_CONFIDENCE_THRESHOLD ||
      !linkedIssueRef
    ) {
      continue;
    }

    const exists = await ensureLinkedIssueExists({
      akbAdapter,
      vault,
      linkedIssueRef,
    });
    if (!exists) {
      semanticLinkNoLink++;
      continue;
    }
    activity.issueRef = linkedIssueRef;
    activity.link = {
      source: "semantic",
      confidence: decision.confidence,
      rationale: decision.rationale,
    };
    semanticLinkLinked++;
  }

  setAttribute("semantic_link.attempted", semanticLinkAttempted);
  setAttribute("semantic_link.linked_count", semanticLinkLinked);
  setAttribute("semantic_link.possible_count", semanticLinkPossible);
  setAttribute("semantic_link.no_link_count", semanticLinkNoLink);
}

function groupTrackedActivities(
  activities: readonly NormalisedActivity[],
): Map<string, NormalisedActivity[]> {
  const trackedByIssue = new Map<string, NormalisedActivity[]>();
  for (const activity of activities) {
    if (activity.issueRef === null) continue;
    const bucket = trackedByIssue.get(activity.issueRef) ?? [];
    bucket.push(activity);
    trackedByIssue.set(activity.issueRef, bucket);
  }
  return trackedByIssue;
}
