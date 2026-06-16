import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { AkbAdapter } from "../adapters/akb";
import {
  allocateNextIssueId,
  buildIssueMetadataFromCreateInput,
  ensureReefTables,
  listIssues,
  readActivitySuggestion,
  readIssue,
  updateActivitySuggestionStatus,
  updateIssue,
  writeIssue,
} from "../adapters/akb";
import { ActivitySuggestionError } from "../errors";
import { buildIssueUpdateMetadataPatch } from "../models/issueUpdate";
import { isForwardStatus, withRecoveredDraftStatus } from "../models/status";
import type { ActivitySuggestion } from "../schemas/activity/suggestion";
import {
  implementationRefsFromStatusEvidence,
  mergeImplementationRefs,
} from "./activityScan/artifacts";

const tracer = trace.getTracer("@reef/core");

export interface ApproveActivitySuggestionParams {
  adapter: AkbAdapter;
  vault: string;
  id: string;
  actor: string;
  prefix?: string;
}

export interface ApproveActivitySuggestionResult {
  /** The suggestion in its post-approval state (or as-read for a no-op). */
  suggestion: ActivitySuggestion;
  /** The reef issue the approval created or targeted (absent on a status no-op). */
  issueId?: string;
  /** The status-change commit hash (`""` for a no-op or idempotent recovery). */
  commit_hash?: string;
}

/**
 * Apply an activity-inbox suggestion to the workspace and finalize it. This is
 * the write-side counterpart to the read-side `scanActivity`; the Route Handler
 * is a thin wrapper that parses, delegates here, and translates the result.
 *
 * Two kinds:
 *   - `draft`         → create the proposed issue (or finalize against an issue
 *                       a prior partial approval already created), then mark the
 *                       suggestion approved.
 *   - `status_change` → re-validate the target status against the issue's LIVE
 *                       status and apply a status patch, then mark approved.
 *
 * Rejections surface as `ActivitySuggestionError`, which carries the PM-facing
 * message and HTTP status for the caller to translate:
 *   - `dismissed` / `stale`                              → 409
 *   - `prefix_required` / `status_missing` / `closed_target` → 400
 */
export async function approveActivitySuggestion(
  params: ApproveActivitySuggestionParams,
): Promise<ApproveActivitySuggestionResult> {
  const { adapter, vault, id, actor, prefix } = params;

  return tracer.startActiveSpan(
    "reef.agent.approveActivitySuggestion",
    async (span) => {
      span.setAttribute("vault", vault);
      span.setAttribute("suggestion_id", id);
      try {
        await ensureReefTables({ adapter, vault });
        const { suggestion } = await readActivitySuggestion({
          adapter,
          vault,
          id,
        });

        if (suggestion.status === "dismissed") {
          throw new ActivitySuggestionError("dismissed");
        }

        if (suggestion.kind === "draft") {
          const source = `ai-agent:create_issue:${suggestion.id}`;
          const legacySource = `ai-agent:draft_issue:${suggestion.id}`;
          const existingIssue = (
            await listIssues({ adapter, vault })
          ).issues.find(
            (issue) => issue.source === source || issue.source === legacySource,
          );
          if (existingIssue) {
            const updated = await updateActivitySuggestionStatus({
              adapter,
              vault,
              id,
              status: "approved",
              approved_issue_id: existingIssue.id,
            });
            return {
              suggestion: updated.suggestion,
              issueId: existingIssue.id,
            };
          }
          if (
            suggestion.status === "approved" &&
            suggestion.approved_issue_id
          ) {
            return { suggestion, issueId: suggestion.approved_issue_id };
          }
          if (!prefix) {
            throw new ActivitySuggestionError("prefix_required");
          }

          const issueId = await allocateNextIssueId({ adapter, vault, prefix });
          const issue = buildIssueMetadataFromCreateInput({
            id: issueId,
            // Recover a code-signal status for a status-less draft (pre-REEF-130,
            // or one an edit rebuilt without it) so in-flight work isn't dropped
            // into the `backlog` default. Shared with the agent-artifact path.
            create: withRecoveredDraftStatus(
              suggestion.proposal.create,
              suggestion.provenance.type,
            ),
            source,
            author: actor,
          });
          await writeIssue({
            adapter,
            vault,
            issue,
            content: suggestion.proposal.create.content,
          });
          const updated = await updateActivitySuggestionStatus({
            adapter,
            vault,
            id,
            status: "approved",
            approved_issue_id: issueId,
          });
          return { suggestion: updated.suggestion, issueId };
        }

        if (suggestion.status === "approved") {
          return { suggestion, commit_hash: "" };
        }
        // Closing an issue requires a closure reason, which the activity inbox does
        // not collect — that lives in the dedicated close flow. AI status changes
        // are forward-progress just; reject a "closed" target defensively (the card
        // dropdown and PATCH validation already exclude it).
        const update = suggestion.proposal.update;
        const toStatus = update.patch.status;
        if (!toStatus) {
          throw new ActivitySuggestionError("status_missing");
        }
        if (toStatus === "closed") {
          throw new ActivitySuggestionError("closed_target");
        }
        // Re-validate against the issue's CURRENT status at approval time. The
        // suggestion's `from_status` was captured at scan time; the issue may have
        // moved since (manual edit, another approval). Applying a stale target status
        // could reverse the issue (e.g. done -> in_progress) or be a no-op. Gate on
        // the same forward-moving check the scan used (`isForwardStatus`), now from
        // live status — forward jumps allowed, reverse/self rejected.
        const source = `ai-agent:status_change:${suggestion.id}`;
        const currentIssue = await readIssue({
          adapter,
          vault,
          id: update.issue_id,
        });
        // Idempotent recovery: writeIssue (issue) and the suggestion-status update
        // are two non-transactional writes. If a prior approval applied the issue
        // change but failed before marking the suggestion approved, the issue is
        // already at the target status and stamped with THIS suggestion's source. Finalize
        // the suggestion instead of 409-ing on the now self-transition.
        if (
          currentIssue.issue.status === toStatus &&
          currentIssue.issue.source === source
        ) {
          const updated = await updateActivitySuggestionStatus({
            adapter,
            vault,
            id,
            status: "approved",
          });
          return {
            suggestion: updated.suggestion,
            issueId: update.issue_id,
            commit_hash: "",
          };
        }
        if (!isForwardStatus(currentIssue.issue.status, toStatus)) {
          throw new ActivitySuggestionError("stale");
        }
        // Status-change branch: apply the target status to the issue (plus a
        // status-change timestamp + provenance), AND record the suggestion's
        // PR/commit evidence as delivery refs in the SAME update — mapped to
        // implementation_refs, merged into any refs already on the issue, and
        // de-duplicated on type:repo:ref so re-approving/re-scanning the same
        // activity does not doubles an entry (REEF-138). This mirrors the
        // draft→create path, which fills implementation_refs for brand-new
        // issues. The rationale is shown in the inbox but does not written to the
        // issue — it is discarded on approve.
        const deliveryRefs = mergeImplementationRefs(
          currentIssue.issue.implementation_refs,
          implementationRefsFromStatusEvidence(
            suggestion.evidence,
            suggestion.detected_at,
          ),
        );
        const statusUpdate = {
          issue_id: update.issue_id,
          patch: { status: toStatus, implementation_refs: deliveryRefs },
        };
        const updateResult = await updateIssue({
          adapter,
          vault,
          id: update.issue_id,
          partial: buildIssueUpdateMetadataPatch({
            update: statusUpdate,
            actor,
            source,
          }),
        });
        const updated = await updateActivitySuggestionStatus({
          adapter,
          vault,
          id,
          status: "approved",
        });
        return {
          suggestion: updated.suggestion,
          issueId: update.issue_id,
          commit_hash: updateResult.commit_hash,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw err;
      } finally {
        span.end();
      }
    },
  );
}
