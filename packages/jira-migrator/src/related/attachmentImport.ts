import { resolveJiraActor } from "../accounts/mapping.js";
import { fingerprintJiraState } from "../execution/diff.js";
import {
  type JiraMigrationLedgerV1,
  confirmJiraMigrationBinding,
  jiraAttachmentSourceIdentity,
  jiraCommentSourceIdentity,
  removeJiraMigrationBindings,
} from "../ledger.js";
import type {
  JiraCommentPayload,
  NormalizedJiraAttachment,
} from "../payloads.js";
import {
  attachmentReadbackMismatches,
  resolveAttachmentMimeType,
  validAttachmentReadback,
} from "./attachments.js";
import { revokeCommentTargets } from "./comments.js";
import { MISSING_SOURCE_TIMESTAMP } from "./constants.js";
import type {
  AttachmentBinding,
  JiraRelatedImportFailure,
  JiraRelatedImportInput,
  JiraRelatedImportReport,
} from "./contracts.js";
import { revokedAttachmentPlaceholder } from "./media.js";
import { recordRelatedOperation } from "./operations.js";
import { failure } from "./reporting.js";

const attachmentFailureReason = (error: unknown): string => {
  const rendered = String(error);
  if (rendered.includes("attachment_readback_mismatch:"))
    return rendered.slice(rendered.indexOf("attachment_readback_mismatch:"));
  if (
    rendered.includes("size_mismatch") ||
    rendered.includes("content_length_mismatch")
  )
    return "attachment_size_mismatch";
  if (rendered.includes("size_limit")) return "attachment_size_limit_exceeded";
  if (!(error instanceof Error)) return "attachment_import_failed:unknown";
  const safeName = error.name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase();
  const status =
    "status" in error &&
    typeof error.status === "number" &&
    Number.isInteger(error.status)
      ? `_${error.status}`
      : "";
  return `attachment_import_failed:${safeName}${status}`;
};

export async function importAttachments(options: {
  migration: JiraRelatedImportInput;
  issueId: string;
  comments: readonly JiraCommentPayload[];
  unsafeCommentIds: ReadonlySet<string>;
  attachments: readonly NormalizedJiraAttachment[];
  attachmentAclEstablished: boolean;
  attachmentBytePolicyInvalid: boolean;
  attachmentCatalogPresent: boolean;
  sourceLedger: JiraMigrationLedgerV1;
  ledger: JiraMigrationLedgerV1;
  report: JiraRelatedImportReport;
  now: () => string;
}): Promise<{
  ledger: JiraMigrationLedgerV1;
  attachmentBindings: AttachmentBinding[];
}> {
  const assertAttachmentReadback = (
    ...args: Parameters<typeof attachmentReadbackMismatches>
  ): void => {
    const mismatches = attachmentReadbackMismatches(...args);
    if (mismatches.length > 0)
      throw new Error(`attachment_readback_mismatch:${mismatches.join(",")}`);
  };
  const {
    migration,
    issueId,
    comments,
    unsafeCommentIds,
    attachments,
    attachmentAclEstablished,
    attachmentBytePolicyInvalid,
    attachmentCatalogPresent,
    sourceLedger,
    report,
    now,
  } = options;
  let ledger = options.ledger;
  const attachmentBindings: AttachmentBinding[] = [];
  const returnedAttachmentIds = new Set(
    attachments.map((attachment) => attachment.id),
  );
  const missingAttachmentBindings = sourceLedger.bindings.filter(
    (binding) =>
      binding.source_identity.entity_kind === "attachment" &&
      binding.source_identity.jira_cloud_id === migration.jiraCloudId &&
      (binding.source_identity.issue_id === undefined ||
        binding.source_identity.issue_id === issueId) &&
      ((migration.attachmentPolicy !== undefined &&
        !attachmentAclEstablished) ||
        (attachmentCatalogPresent &&
          !returnedAttachmentIds.has(binding.source_identity.attachment_id))),
  );
  const revokeAttachmentBinding = async (
    identity: ReturnType<typeof jiraAttachmentSourceIdentity>,
    attachmentId: string,
  ): Promise<void> => {
    const binding = ledger.bindings.find(
      (item) => item.source_key === identity.key,
    );
    const recovered = await migration.target.findAttachmentByJiraId(
      migration.reefId,
      migration.jiraCloudId,
      attachmentId,
    );
    const fileUris = new Set<string>();
    if (binding?.target.target_kind === "attachment")
      fileUris.add(binding.target.file_uri);
    if (
      recovered?.attachment.source === "jira_import" &&
      recovered.attachment.reef_id === migration.reefId &&
      recovered.attachment.original_jira_attachment_id === attachmentId &&
      recovered.attachment.meta?.source === "jira" &&
      recovered.attachment.meta?.jira_cloud_id === migration.jiraCloudId
    )
      fileUris.add(recovered.attachment.file_uri);
    for (const fileUri of fileUris) {
      await migration.target.revokeAttachment({
        reefId: migration.reefId,
        fileUri,
        replacement: revokedAttachmentPlaceholder(attachmentId),
      });
      if (migration.mode === "apply") {
        if ((await migration.target.readAttachment(fileUri)) !== null)
          throw new Error("attachment_revocation_readback_mismatch");
        if (await migration.target.hasMediaReference(migration.reefId, fileUri))
          throw new Error("attachment_reference_revocation_readback_mismatch");
      }
    }
    if (migration.mode === "apply")
      ledger = removeJiraMigrationBindings(ledger, [identity.key]);
  };
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const commentDepth = (commentId: string): number => {
    let depth = 0;
    let current = commentById.get(commentId);
    const visited = new Set<string>();
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      depth += 1;
      current = commentById.get(current.parentId);
    }
    return depth;
  };
  const unsafeCommentRevokeOrder = [...unsafeCommentIds].sort(
    (left, right) =>
      commentDepth(right) - commentDepth(left) || left.localeCompare(right),
  );

  {
    let pendingCommentRevocations = unsafeCommentRevokeOrder;
    const commentRevocationErrors = new Map<string, unknown>();
    while (pendingCommentRevocations.length > 0) {
      const retry: string[] = [];
      let progress = false;
      for (const commentId of pendingCommentRevocations) {
        const identity = jiraCommentSourceIdentity(
          migration.jiraCloudId,
          issueId,
          commentId,
        );
        try {
          const binding = ledger.bindings.find(
            (candidate) => candidate.source_key === identity.key,
          );
          const recovered = await migration.target.findCommentByIdempotencyKey(
            identity.key,
          );
          await revokeCommentTargets(
            migration.target,
            [
              binding?.target.target_kind === "comment"
                ? binding.target.comment_id
                : null,
              recovered?.id,
            ],
            migration.mode,
          );
          if (migration.mode === "apply")
            ledger = removeJiraMigrationBindings(ledger, [identity.key]);
          commentRevocationErrors.delete(commentId);
          progress = true;
        } catch (error) {
          commentRevocationErrors.set(commentId, error);
          retry.push(commentId);
        }
      }
      pendingCommentRevocations = retry;
      if (!progress) break;
    }
    for (const commentId of pendingCommentRevocations) {
      const error = commentRevocationErrors.get(commentId);
      failure(
        report.failures,
        "comment",
        commentId,
        String(error).includes("readback") ? "readback" : "write",
        "comment_catalog_reconciliation_failed",
        error,
      );
    }

    for (const binding of missingAttachmentBindings) {
      const attachmentId =
        binding.source_identity.entity_kind === "attachment"
          ? binding.source_identity.attachment_id
          : "missing";
      try {
        const boundReadback =
          binding.target.target_kind === "attachment"
            ? await migration.target.readAttachment(binding.target.file_uri)
            : null;
        const recovered = await migration.target.findAttachmentByJiraId(
          migration.reefId,
          migration.jiraCloudId,
          attachmentId,
        );
        const belongsToCurrentIssue =
          binding.source_identity.entity_kind === "attachment" &&
          (binding.source_identity.issue_id === issueId ||
            boundReadback?.attachment.reef_id === migration.reefId ||
            recovered !== null);
        if (!belongsToCurrentIssue) continue;
        await revokeAttachmentBinding(
          jiraAttachmentSourceIdentity(
            migration.jiraCloudId,
            issueId,
            attachmentId,
          ),
          attachmentId,
        );
      } catch (error) {
        failure(
          report.failures,
          "attachment",
          attachmentId,
          String(error).includes("readback") ? "readback" : "write",
          "attachment_source_reconciliation_failed",
          error,
        );
      }
    }
  }

  for (const attachment of attachments) {
    const identity = jiraAttachmentSourceIdentity(
      migration.jiraCloudId,
      issueId,
      attachment.id,
    );
    if (migration.attachmentPolicy === undefined) {
      failure(
        report.failures,
        "attachment",
        attachment.id,
        "resolve",
        "attachment_visibility_unverifiable",
      );
      continue;
    }
    if (!attachmentAclEstablished) {
      try {
        await revokeAttachmentBinding(identity, attachment.id);
      } catch (error) {
        failure(
          report.failures,
          "attachment",
          attachment.id,
          String(error).includes("readback") ? "readback" : "write",
          "attachment_visibility_revocation_failed",
          error,
        );
      }
      failure(
        report.failures,
        "attachment",
        attachment.id,
        "resolve",
        "attachment_visibility_unverifiable",
      );
      continue;
    }
    if (attachmentBytePolicyInvalid) {
      failure(
        report.failures,
        "attachment",
        attachment.id,
        "resolve",
        "attachment_size_policy_invalid",
      );
      continue;
    }
    const maxAttachmentBytes = migration.attachmentPolicy?.maxBytes;
    if (
      maxAttachmentBytes !== undefined &&
      attachment.size !== null &&
      attachment.size > maxAttachmentBytes
    ) {
      try {
        await revokeAttachmentBinding(identity, attachment.id);
      } catch (error) {
        failure(
          report.failures,
          "attachment",
          attachment.id,
          String(error).includes("readback") ? "readback" : "write",
          "attachment_size_policy_revocation_failed",
          error,
        );
      }
      failure(
        report.failures,
        "attachment",
        attachment.id,
        "resolve",
        "attachment_size_limit_exceeded",
      );
      continue;
    }
    const existing = ledger.bindings.find(
      (item) => item.source_key === identity.key,
    );
    const mappedAuthor = resolveJiraActor(
      "attachment_author",
      attachment.author,
      {
        artifact: migration.accountMapping,
        directory: migration.actorDirectory ?? [],
      },
    ).actor;
    const expectedAttachmentBase = {
      reefId: migration.reefId,
      author: mappedAuthor ?? "jira-import",
      createdAt: attachment.created ?? MISSING_SOURCE_TIMESTAMP,
      jiraCloudId: migration.jiraCloudId,
    };
    let attachmentPhase: JiraRelatedImportFailure["phase"] = "read";
    try {
      let download: Awaited<
        ReturnType<typeof migration.client.downloadAttachmentContent>
      > | null = null;
      if (existing?.target.target_kind === "attachment") {
        download = await migration.client.downloadAttachmentContent(
          attachment.id,
          maxAttachmentBytes,
        );
        if (
          attachment.size !== null &&
          download.bytes.byteLength !== attachment.size
        )
          throw new Error("attachment_size_mismatch");
        const expectedAttachment = {
          ...expectedAttachmentBase,
          mimeType: resolveAttachmentMimeType(
            attachment.mimeType,
            download.contentType,
            attachment.filename,
            download.bytes,
          ),
        };
        attachmentPhase = "readback";
        const readback = await migration.target.readAttachment(
          existing.target.file_uri,
        );
        const mismatches = attachmentReadbackMismatches(
          readback,
          attachment,
          { ...expectedAttachment, fileUri: existing.target.file_uri },
          download.bytes,
        );
        if (mismatches.length === 0) {
          attachmentBindings.push({
            source: attachment,
            fileUri: existing.target.file_uri,
          });
          report.attachments.skipped += 1;
          continue;
        }
        if (migration.mode === "dry-run") {
          recordRelatedOperation(report, "revoke_attachment", identity.key, {
            reefId: migration.reefId,
            fileUri: existing.target.file_uri,
            replacement: revokedAttachmentPlaceholder(attachment.id),
          });
        } else {
          await revokeAttachmentBinding(identity, attachment.id);
        }
      }
      const recovered =
        existing?.target.target_kind === "attachment"
          ? null
          : await migration.target.findAttachmentByJiraId(
              migration.reefId,
              migration.jiraCloudId,
              attachment.id,
            );
      if (recovered) {
        attachmentPhase = "read";
        download = await migration.client.downloadAttachmentContent(
          attachment.id,
          maxAttachmentBytes,
        );
        if (
          attachment.size !== null &&
          download.bytes.byteLength !== attachment.size
        )
          throw new Error("attachment_size_mismatch");
        const expectedAttachment = {
          ...expectedAttachmentBase,
          mimeType: resolveAttachmentMimeType(
            attachment.mimeType,
            download.contentType,
            attachment.filename,
            download.bytes,
          ),
        };
        attachmentPhase = "readback";
        const mismatches = attachmentReadbackMismatches(
          recovered,
          attachment,
          {
            ...expectedAttachment,
            fileUri: recovered.attachment.file_uri,
          },
          download.bytes,
        );
        if (mismatches.length === 0) {
          attachmentBindings.push({
            source: attachment,
            fileUri: recovered.attachment.file_uri,
          });
          if (migration.mode === "apply") {
            ledger = confirmJiraMigrationBinding(ledger, {
              sourceIdentity: identity,
              target: {
                target_kind: "attachment",
                file_uri: recovered.attachment.file_uri,
              },
              sourceFingerprint: fingerprintJiraState(attachment),
              mappedStateFingerprint: fingerprintJiraState({
                file_uri: recovered.attachment.file_uri,
                size: recovered.bytes.byteLength,
              }),
              lastAppliedAt: now(),
              writeSucceeded: true,
              readbackSucceeded: true,
            });
          }
          report.attachments.skipped += 1;
          continue;
        }
        if (migration.mode === "dry-run") {
          recordRelatedOperation(report, "revoke_attachment", identity.key, {
            reefId: migration.reefId,
            fileUri: recovered.attachment.file_uri,
            replacement: revokedAttachmentPlaceholder(attachment.id),
          });
        } else {
          await revokeAttachmentBinding(identity, attachment.id);
        }
      }
      attachmentPhase = "read";
      download ??= await migration.client.downloadAttachmentContent(
        attachment.id,
        maxAttachmentBytes,
      );
      if (
        attachment.size !== null &&
        download.bytes.byteLength !== attachment.size
      )
        throw new Error("attachment_size_mismatch");
      const mimeType = resolveAttachmentMimeType(
        attachment.mimeType,
        download.contentType,
        attachment.filename,
        download.bytes,
      );
      const createInput = {
        idempotencyKey: identity.key,
        reefId: migration.reefId,
        filename: attachment.filename,
        mimeType,
        bytes: download.bytes,
        author: mappedAuthor ?? "jira-import",
        createdAt: expectedAttachmentBase.createdAt,
        originalJiraAttachmentId: attachment.id,
        meta: { source: "jira", jira_cloud_id: migration.jiraCloudId },
      };
      if (migration.mode === "dry-run") {
        recordRelatedOperation(
          report,
          "create_attachment",
          identity.key,
          createInput,
        );
        attachmentBindings.push({
          source: attachment,
          fileUri: `dry-run://attachment/${encodeURIComponent(attachment.id)}`,
        });
        continue;
      }
      const expectedAttachment = { ...expectedAttachmentBase, mimeType };
      const sourceFingerprint = fingerprintJiraState(attachment);
      attachmentPhase = "write";
      try {
        const created = await migration.target.createAttachment(createInput);
        attachmentPhase = "readback";
        const readback = await migration.target.readAttachment(
          created.file_uri,
        );
        assertAttachmentReadback(
          readback,
          attachment,
          { ...expectedAttachment, fileUri: created.file_uri },
          download.bytes,
        );
        report.attachments.bytes += download.bytes.byteLength;
        report.attachments.created += 1;
        attachmentBindings.push({
          source: attachment,
          fileUri: created.file_uri,
        });
        ledger = confirmJiraMigrationBinding(ledger, {
          sourceIdentity: identity,
          target: { target_kind: "attachment", file_uri: created.file_uri },
          sourceFingerprint,
          mappedStateFingerprint: fingerprintJiraState({
            file_uri: created.file_uri,
            size: download.bytes.byteLength,
          }),
          lastAppliedAt: now(),
          writeSucceeded: true,
          readbackSucceeded: true,
        });
      } catch (writeError) {
        attachmentPhase = "readback";
        const residual = await migration.target.findAttachmentByJiraId(
          migration.reefId,
          migration.jiraCloudId,
          attachment.id,
        );
        if (!residual) {
          attachmentPhase = "write";
          throw writeError;
        }
        const residualIsValid = validAttachmentReadback(
          residual,
          attachment,
          { ...expectedAttachment, fileUri: residual.attachment.file_uri },
          download.bytes,
        );
        ledger = confirmJiraMigrationBinding(ledger, {
          sourceIdentity: identity,
          target: {
            target_kind: "attachment",
            file_uri: residual.attachment.file_uri,
          },
          sourceFingerprint,
          mappedStateFingerprint: residualIsValid
            ? fingerprintJiraState({
                file_uri: residual.attachment.file_uri,
                size: download.bytes.byteLength,
              })
            : fingerprintJiraState(residual),
          lastAppliedAt: now(),
          writeSucceeded: true,
          readbackSucceeded: true,
        });
        if (!residualIsValid) {
          await revokeAttachmentBinding(identity, attachment.id);
          throw writeError;
        }
        report.attachments.bytes += download.bytes.byteLength;
        report.attachments.created += 1;
        attachmentBindings.push({
          source: attachment,
          fileUri: residual.attachment.file_uri,
        });
      }
    } catch (error) {
      if (
        migration.mode === "apply" &&
        String(error).includes("size_limit_exceeded")
      ) {
        try {
          await revokeAttachmentBinding(identity, attachment.id);
        } catch (revocationError) {
          failure(
            report.failures,
            "attachment",
            attachment.id,
            String(revocationError).includes("readback") ? "readback" : "write",
            "attachment_size_policy_revocation_failed",
            revocationError,
          );
        }
      }
      failure(
        report.failures,
        "attachment",
        attachment.id,
        attachmentPhase,
        attachmentFailureReason(error),
        error,
      );
    }
  }

  return { ledger, attachmentBindings };
}
