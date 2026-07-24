import { mapJiraCommentActor } from "../accounts/mapping.js";
import { convertAdfToMarkdown } from "../content/adf.js";
import { fingerprintJiraState } from "../execution/diff.js";
import {
  type JiraMigrationLedgerV1,
  confirmJiraMigrationBinding,
  getJiraCommentTargetId,
  jiraCommentSourceIdentity,
  removeJiraMigrationBindings,
} from "../ledger.js";
import type {
  JiraCommentPayload,
  NormalizedJiraAttachment,
} from "../payloads.js";
import {
  jiraCommentVisibility,
  revokeCommentTargets,
  validCommentReadback,
} from "./comments.js";
import { MISSING_SOURCE_TIMESTAMP } from "./constants.js";
import type {
  AttachmentBinding,
  JiraImportedCommentInput,
  JiraRelatedImportInput,
  JiraRelatedImportReport,
} from "./contracts.js";
import { rewriteMedia } from "./media.js";
import { recordRelatedOperation } from "./operations.js";
import { failure } from "./reporting.js";

export async function importComments(options: {
  migration: JiraRelatedImportInput;
  issueId: string;
  comments: readonly JiraCommentPayload[];
  unsafeVisibilityCommentIds: ReadonlySet<string>;
  unsafeCommentSourceKeys: Set<string>;
  plannedCommentTargets: Map<string, string>;
  attachmentBindings: readonly AttachmentBinding[];
  attachments: readonly NormalizedJiraAttachment[];
  ledger: JiraMigrationLedgerV1;
  report: JiraRelatedImportReport;
  now: () => string;
}): Promise<JiraMigrationLedgerV1> {
  const {
    migration,
    issueId,
    comments,
    unsafeVisibilityCommentIds,
    unsafeCommentSourceKeys,
    plannedCommentTargets,
    attachmentBindings,
    attachments,
    report,
    now,
  } = options;
  let ledger = options.ledger;
  const roots = comments.filter((item) => item.parentId == null);
  const pendingReplies = comments.filter((item) => item.parentId != null);
  const orderedComments = [...roots];
  while (pendingReplies.length > 0) {
    const nextIndex = pendingReplies.findIndex(
      (candidate) =>
        !pendingReplies.some((other) => other.id === candidate.parentId),
    );
    if (nextIndex < 0) {
      orderedComments.push(...pendingReplies.splice(0));
      break;
    }
    const [next] = pendingReplies.splice(nextIndex, 1);
    if (next) orderedComments.push(next);
  }
  for (const comment of orderedComments) {
    const identity = jiraCommentSourceIdentity(
      migration.jiraCloudId,
      issueId,
      comment.id,
    );
    const visibility = jiraCommentVisibility(comment);
    if (visibility !== "safe" || unsafeVisibilityCommentIds.has(comment.id)) {
      unsafeCommentSourceKeys.add(identity.key);
      failure(
        report.failures,
        "comment",
        comment.id,
        "resolve",
        visibility === "restricted" ||
          unsafeVisibilityCommentIds.has(comment.id)
          ? "comment_visibility_restricted"
          : "comment_visibility_unverified",
      );
      continue;
    }
    const parentSourceId = comment.parentId ?? null;
    const parentTargetId =
      parentSourceId === null
        ? null
        : (plannedCommentTargets.get(parentSourceId) ??
          getJiraCommentTargetId(
            removeJiraMigrationBindings(ledger, [...unsafeCommentSourceKeys]),
            jiraCommentSourceIdentity(
              migration.jiraCloudId,
              issueId,
              parentSourceId,
            ),
          ) ??
          null);
    if (parentSourceId !== null && parentTargetId === null) {
      unsafeCommentSourceKeys.add(identity.key);
      failure(
        report.failures,
        "comment",
        comment.id,
        "resolve",
        "comment_parent_unresolved",
      );
      continue;
    }
    try {
      const body = rewriteMedia(
        comment.body,
        attachmentBindings,
        comment.renderedBody ?? "",
        report,
        comment.id,
        attachments,
      );
      if (!body.resolved) continue;
      const actor = mapJiraCommentActor(comment, {
        artifact: migration.accountMapping,
        directory: migration.actorDirectory ?? [],
      });
      let expectedThreadRootId: string | null = null;
      if (parentTargetId && !parentTargetId.startsWith("dry-run-comment:")) {
        const parentReadback =
          await migration.target.readComment(parentTargetId);
        if (!parentReadback) throw new Error("comment_parent_readback_missing");
        expectedThreadRootId =
          parentReadback.thread_root_id ?? parentReadback.id;
      }
      const commentInput: JiraImportedCommentInput = {
        idempotencyKey: identity.key,
        reefId: migration.reefId,
        body: body.markdown,
        author: actor.actor ?? "jira-import",
        createdAt: comment.created ?? MISSING_SOURCE_TIMESTAMP,
        editedAt:
          comment.updated && comment.updated !== comment.created
            ? comment.updated
            : null,
        expectedThreadRootId,
        ...(parentTargetId ? { parentCommentId: parentTargetId } : {}),
      };
      const sourceFingerprint = fingerprintJiraState(comment);
      const mappedStateFingerprint = fingerprintJiraState({
        body: body.markdown,
        author: actor.actor,
        parent: parentTargetId,
      });
      let existingTarget = getJiraCommentTargetId(ledger, identity);
      if (existingTarget) {
        const existing = await migration.target.readComment(existingTarget);
        if (existing === null) {
          if (migration.mode === "dry-run") {
            recordRelatedOperation(
              report,
              "update_comment",
              existingTarget,
              commentInput,
            );
            plannedCommentTargets.set(
              comment.id,
              `dry-run-comment:${comment.id}`,
            );
            report.comments.updated += 1;
            continue;
          }
          ledger = removeJiraMigrationBindings(ledger, [identity.key]);
          existingTarget = null;
        }
        if (existingTarget === null) {
          // A quarantined comment returned safely; recreate it below.
        } else if (validCommentReadback(existing, commentInput)) {
          const existingBinding = ledger.bindings.find(
            (binding) => binding.source_key === identity.key,
          );
          if (
            migration.mode === "apply" &&
            (existingBinding?.source_fingerprint !== sourceFingerprint ||
              existingBinding.mapped_state_fingerprint !==
                mappedStateFingerprint)
          ) {
            ledger = confirmJiraMigrationBinding(ledger, {
              sourceIdentity: identity,
              target: { target_kind: "comment", comment_id: existingTarget },
              sourceFingerprint,
              mappedStateFingerprint,
              lastAppliedAt: now(),
              writeSucceeded: true,
              readbackSucceeded: true,
            });
          }
          report.comments.skipped += 1;
          continue;
        } else if (migration.mode === "dry-run") {
          recordRelatedOperation(
            report,
            "update_comment",
            existingTarget,
            commentInput,
          );
          report.comments.updated += 1;
          continue;
        } else {
          await migration.target.updateComment(existingTarget, commentInput);
          const readback = await migration.target.readComment(existingTarget);
          if (!validCommentReadback(readback, commentInput))
            throw new Error("comment_update_readback_mismatch");
          ledger = confirmJiraMigrationBinding(ledger, {
            sourceIdentity: identity,
            target: { target_kind: "comment", comment_id: existingTarget },
            sourceFingerprint,
            mappedStateFingerprint,
            lastAppliedAt: now(),
            writeSucceeded: true,
            readbackSucceeded: true,
          });
          plannedCommentTargets.set(comment.id, existingTarget);
          report.comments.updated += 1;
          continue;
        }
      }
      const recovered = await migration.target.findCommentByIdempotencyKey(
        identity.key,
      );
      if (recovered) {
        plannedCommentTargets.set(comment.id, recovered.id);
        const matches = validCommentReadback(recovered, commentInput);
        if (migration.mode === "apply") {
          ledger = confirmJiraMigrationBinding(ledger, {
            sourceIdentity: identity,
            target: { target_kind: "comment", comment_id: recovered.id },
            sourceFingerprint,
            mappedStateFingerprint: matches
              ? mappedStateFingerprint
              : fingerprintJiraState(recovered),
            lastAppliedAt: now(),
            writeSucceeded: true,
            readbackSucceeded: true,
          });
          if (!matches) {
            await migration.target.updateComment(recovered.id, commentInput);
            const readback = await migration.target.readComment(recovered.id);
            if (!validCommentReadback(readback, commentInput))
              throw new Error("comment_update_readback_mismatch");
            ledger = confirmJiraMigrationBinding(ledger, {
              sourceIdentity: identity,
              target: { target_kind: "comment", comment_id: recovered.id },
              sourceFingerprint,
              mappedStateFingerprint,
              lastAppliedAt: now(),
              writeSucceeded: true,
              readbackSucceeded: true,
            });
          }
        }
        if (matches) report.comments.skipped += 1;
        else {
          if (migration.mode === "dry-run") {
            recordRelatedOperation(
              report,
              "update_comment",
              recovered.id,
              commentInput,
            );
          }
          report.comments.updated += 1;
        }
        continue;
      }
      if (migration.mode === "dry-run") {
        recordRelatedOperation(
          report,
          "create_comment",
          identity.key,
          commentInput,
        );
        plannedCommentTargets.set(comment.id, `dry-run-comment:${comment.id}`);
        continue;
      }
      let createdTargetId: string | null = null;
      try {
        const created = await migration.target.createComment(commentInput);
        createdTargetId = created.id;
        const readback = await migration.target.readComment(created.id);
        if (!validCommentReadback(readback, commentInput))
          throw new Error("comment_readback_mismatch");
        ledger = confirmJiraMigrationBinding(ledger, {
          sourceIdentity: identity,
          target: { target_kind: "comment", comment_id: created.id },
          sourceFingerprint,
          mappedStateFingerprint,
          lastAppliedAt: now(),
          writeSucceeded: true,
          readbackSucceeded: true,
        });
        report.comments.created += 1;
      } catch (error) {
        const residual = createdTargetId
          ? await migration.target.readComment(createdTargetId)
          : await migration.target.findCommentByIdempotencyKey(identity.key);
        if (residual) {
          ledger = confirmJiraMigrationBinding(ledger, {
            sourceIdentity: identity,
            target: { target_kind: "comment", comment_id: residual.id },
            sourceFingerprint,
            mappedStateFingerprint: fingerprintJiraState(residual),
            lastAppliedAt: now(),
            writeSucceeded: true,
            readbackSucceeded: true,
          });
          let rollbackError: unknown = null;
          try {
            await migration.target.deleteComment(residual.id);
          } catch (cleanupFailure) {
            rollbackError = cleanupFailure;
          }
          const residualReadback = await migration.target.readComment(
            residual.id,
          );
          if (residualReadback)
            throw new AggregateError(
              rollbackError ? [error, rollbackError] : [error],
              "comment_create_rollback_failed",
            );
          ledger = removeJiraMigrationBindings(ledger, [identity.key]);
        }
        throw error;
      }
    } catch (error) {
      failure(
        report.failures,
        "comment",
        comment.id,
        String(error).includes("readback") ? "readback" : "write",
        "comment_import_failed",
        error,
      );
    }
  }

  return ledger;
}
