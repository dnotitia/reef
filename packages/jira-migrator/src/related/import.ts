import { fingerprintJiraState } from "../execution/diff.js";
import { JIRA_MAX_ATTACHMENT_BUFFER_BYTES } from "../jira/client.js";
import {
  type JiraMigrationLedgerV1,
  clearJiraCommentQuarantine,
  jiraCommentSourceIdentity,
  quarantineJiraCommentSource,
  removeJiraMigrationBindings,
} from "../ledger.js";
import type {
  JiraCommentPayload,
  JiraIssuePayload,
  JiraRemoteLinkPayload,
  NormalizedJiraAttachment,
} from "../payloads.js";
import { normalizeJiraIssue } from "../payloads.js";
import { importAttachments } from "./attachmentImport.js";
import { importComments } from "./commentImport.js";
import { jiraCommentVisibility, revokeCommentTargets } from "./comments.js";
import type {
  AttachmentBinding,
  JiraImportedCommentInput,
  JiraLinkMapping,
  JiraRelatedImportFailure,
  JiraRelatedImportInput,
  JiraRelatedImportReport,
  JiraRelatedImportResult,
  JiraRelatedImportTarget,
  JiraRelatedOperationKind,
  JiraRelationKind,
} from "./contracts.js";
import { updateDescriptionMedia } from "./descriptionMedia.js";
import { importIssueLinks } from "./issueLinks.js";
import { recordRelatedOperation, sameRelatedOperation } from "./operations.js";
import { importRemoteLinks } from "./remoteLinks.js";
import { failure, reportTemplate } from "./reporting.js";

export type {
  JiraImportedAttachmentInput,
  JiraImportedCommentInput,
  JiraLinkMapping,
  JiraRelatedImportFailure,
  JiraRelatedImportInput,
  JiraRelatedImportReport,
  JiraRelatedImportResult,
  JiraRelatedImportTarget,
  JiraRelationKind,
} from "./contracts.js";
export {
  resolveJiraMediaReference,
  type JiraMediaResolutionStrategy,
} from "./media.js";
export { canonicalizeJiraRelation } from "./links.js";

export async function importJiraRelatedData(
  input: JiraRelatedImportInput,
): Promise<JiraRelatedImportResult> {
  if (input.mode === "apply" && input.approvedOperations) {
    const {
      approvedOperations,
      checkpointLedger: _checkpointLedger,
      ...preflightInput
    } = input;
    const preflight = await importJiraRelatedData({
      ...preflightInput,
      mode: "dry-run",
    });
    if (preflight.report.failures.length > 0) {
      throw new Error("related_operation_preflight_failed");
    }
    let approvedIndex = 0;
    for (const operation of preflight.report.operations) {
      const relativeIndex = approvedOperations
        .slice(approvedIndex)
        .findIndex((approved) => sameRelatedOperation(approved, operation));
      if (relativeIndex < 0) {
        throw new Error(`related_operation_not_approved:${operation.kind}`);
      }
      approvedIndex += relativeIndex + 1;
    }
  }
  const report = reportTemplate(input.mode);
  const approvalViolations = new Set<JiraRelatedOperationKind>();
  const recordOperation = (
    kind: JiraRelatedOperationKind,
    key: string,
    value: unknown,
  ): void => {
    const operation = recordRelatedOperation(report, kind, key, value);
    if (
      input.mode === "apply" &&
      input.approvedOperations &&
      !input.approvedOperations.some((approved) =>
        sameRelatedOperation(approved, operation),
      )
    ) {
      approvalViolations.add(kind);
      throw new Error("related_operation_not_approved");
    }
  };
  const plannedDeletionKeys = new Set<string>();
  const countDeletion = async (
    key: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    if (input.mode === "dry-run") {
      if (plannedDeletionKeys.has(key)) return;
      plannedDeletionKeys.add(key);
      report.deletions += 1;
      return;
    }
    await operation();
    report.deletions += 1;
  };
  const deletionOverrides: Pick<
    JiraRelatedImportTarget,
    | "deleteComment"
    | "revokeAttachment"
    | "deleteRelation"
    | "deleteExternalRef"
  > = {
    deleteComment: (commentId: string) => {
      recordOperation("delete_comment", commentId, null);
      return countDeletion(`comment:${commentId}`, () =>
        input.target.deleteComment(commentId),
      );
    },
    revokeAttachment: (
      attachment: Parameters<typeof input.target.revokeAttachment>[0],
    ) => {
      recordOperation("revoke_attachment", attachment.fileUri, attachment);
      return countDeletion(`attachment:${attachment.fileUri}`, () =>
        input.target.revokeAttachment(attachment),
      );
    },
    deleteRelation: (idempotencyKey: string) => {
      recordOperation("delete_relation", idempotencyKey, null);
      return countDeletion(`relation:${idempotencyKey}`, () =>
        input.target.deleteRelation(idempotencyKey),
      );
    },
    deleteExternalRef: (idempotencyKey: string) => {
      recordOperation("delete_external_ref", idempotencyKey, null);
      return countDeletion(`external-ref:${idempotencyKey}`, () =>
        input.target.deleteExternalRef(idempotencyKey),
      );
    },
  };
  const mutationOverrides: Pick<
    JiraRelatedImportTarget,
    "createAttachment" | "putRelation" | "putExternalRef"
  > = {
    createAttachment: (value) => {
      recordOperation("create_attachment", value.idempotencyKey, value);
      return input.target.createAttachment(value);
    },
    putRelation: (value) => {
      recordOperation("put_relation", value.idempotencyKey, value);
      return input.target.putRelation(value);
    },
    putExternalRef: (value) => {
      recordOperation("put_external_ref", value.idempotencyKey, value);
      return input.target.putExternalRef(value);
    },
  };
  const overrides = { ...deletionOverrides, ...mutationOverrides };
  const target = new Proxy(input.target, {
    get(target, property) {
      if (property in overrides) {
        return overrides[property as keyof typeof overrides];
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const migration = {
    ...input,
    target,
  };
  const issue = normalizeJiraIssue(input.issue);
  let ledger = input.ledger;
  const [commentsRead, remoteRead] = await Promise.allSettled([
    input.client.readComments(issue.key),
    input.client.listRemoteLinks(issue.key),
  ]);
  const returnedComments =
    commentsRead.status === "fulfilled" ? commentsRead.value.items : [];
  const commentsById = new Map<string, JiraCommentPayload>();
  const conflictingCommentIds = new Set<string>();
  for (const comment of returnedComments) {
    if (conflictingCommentIds.has(comment.id)) continue;
    const existing = commentsById.get(comment.id);
    if (
      existing &&
      fingerprintJiraState(existing) !== fingerprintJiraState(comment)
    ) {
      commentsById.delete(comment.id);
      conflictingCommentIds.add(comment.id);
      failure(
        report.failures,
        "comment",
        comment.id,
        "resolve",
        "jira_comment_duplicate_conflict",
      );
      continue;
    }
    commentsById.set(comment.id, comment);
  }
  const comments = [...commentsById.values()];
  const returnedCommentIds = new Set(
    returnedComments.map((comment) => comment.id),
  );
  const unsafeVisibilityCommentIds = new Set(
    returnedComments
      .filter((comment) => jiraCommentVisibility(comment) !== "safe")
      .map((comment) => comment.id),
  );
  for (const commentId of conflictingCommentIds)
    unsafeVisibilityCommentIds.add(commentId);
  const safeReturnedCommentIds = new Set(
    comments
      .filter(
        (comment) =>
          jiraCommentVisibility(comment) === "safe" &&
          !unsafeVisibilityCommentIds.has(comment.id),
      )
      .map((comment) => comment.id),
  );
  if (input.mode === "apply") {
    ledger = clearJiraCommentQuarantine(
      ledger,
      [...safeReturnedCommentIds].map(
        (commentId) =>
          jiraCommentSourceIdentity(input.jiraCloudId, issue.id, commentId).key,
      ),
    );
  }
  const commentCatalogAuthoritative =
    input.attachmentPolicy?.commentVisibilityCompleteness === "verified" &&
    commentsRead.status === "fulfilled";
  const approvedCommentBindings = input.attachmentPolicy
    ?.approvedCommentBindings
    ? new Map(
        input.attachmentPolicy.approvedCommentBindings.map((binding) => [
          binding.source_key,
          binding,
        ]),
      )
    : null;
  const commentBindingMatchesApproval = (
    binding: JiraMigrationLedgerV1["bindings"][number],
  ): boolean => {
    if (approvedCommentBindings === null) return true;
    const approved = approvedCommentBindings.get(binding.source_key);
    return (
      approved !== undefined &&
      approved.source_fingerprint === binding.source_fingerprint &&
      approved.mapped_state_fingerprint === binding.mapped_state_fingerprint &&
      fingerprintJiraState(approved.target) ===
        fingerprintJiraState(binding.target)
    );
  };
  for (const binding of input.ledger.bindings) {
    if (
      binding.source_identity.entity_kind === "comment" &&
      binding.source_identity.jira_cloud_id === input.jiraCloudId &&
      binding.source_identity.issue_id === issue.id &&
      approvedCommentBindings?.has(binding.source_key) &&
      !commentBindingMatchesApproval(binding) &&
      (input.attachmentPolicy?.approvedCommentBindingsAppliedAfter ===
        undefined ||
        binding.last_applied_at <
          input.attachmentPolicy.approvedCommentBindingsAppliedAfter)
    ) {
      failure(
        report.failures,
        "comment",
        binding.source_identity.comment_id,
        "resolve",
        "comment_binding_precondition_failed",
      );
    }
  }
  const missingCommentBindings = commentCatalogAuthoritative
    ? input.ledger.bindings.filter(
        (binding) =>
          binding.source_identity.entity_kind === "comment" &&
          binding.source_identity.jira_cloud_id === input.jiraCloudId &&
          binding.source_identity.issue_id === issue.id &&
          commentBindingMatchesApproval(binding) &&
          !returnedCommentIds.has(binding.source_identity.comment_id),
      )
    : [];
  const unsafeCommentIds = new Set([
    ...missingCommentBindings.flatMap((binding) =>
      binding.source_identity.entity_kind === "comment"
        ? [binding.source_identity.comment_id]
        : [],
    ),
    ...unsafeVisibilityCommentIds,
    ...ledger.comment_quarantines.flatMap((quarantine) =>
      quarantine.jira_cloud_id === input.jiraCloudId &&
      quarantine.issue_id === issue.id &&
      !safeReturnedCommentIds.has(quarantine.comment_id)
        ? [quarantine.comment_id]
        : [],
    ),
  ]);
  for (const comment of comments) {
    if (
      jiraCommentVisibility(comment) !== "safe" ||
      (comment.parentId !== null &&
        comment.parentId !== undefined &&
        !returnedCommentIds.has(comment.parentId))
    )
      unsafeCommentIds.add(comment.id);
  }
  let unsafeCommentCount = -1;
  while (unsafeCommentCount !== unsafeCommentIds.size) {
    unsafeCommentCount = unsafeCommentIds.size;
    for (const comment of comments) {
      if (comment.parentId && unsafeCommentIds.has(comment.parentId))
        unsafeCommentIds.add(comment.id);
    }
  }
  if (input.mode === "apply") {
    for (const commentId of unsafeCommentIds) {
      ledger = quarantineJiraCommentSource(
        ledger,
        jiraCommentSourceIdentity(input.jiraCloudId, issue.id, commentId),
      );
    }
  }
  const attachmentBytePolicyInvalid =
    input.attachmentPolicy !== undefined &&
    (!Number.isSafeInteger(input.attachmentPolicy.maxBytes) ||
      input.attachmentPolicy.maxBytes <= 0 ||
      input.attachmentPolicy.maxBytes > JIRA_MAX_ATTACHMENT_BUFFER_BYTES);
  const attachmentAclEstablished =
    input.attachmentPolicy?.commentVisibilityCompleteness === "verified" &&
    commentsRead.status === "fulfilled" &&
    unsafeCommentIds.size === 0 &&
    comments.every((comment) => jiraCommentVisibility(comment) === "safe");
  if (commentsRead.status === "rejected") {
    failure(
      report.failures,
      "comment",
      issue.id,
      "read",
      "comment_catalog_read_failed",
      commentsRead.reason,
    );
  }
  const remoteLinks =
    remoteRead.status === "fulfilled" ? remoteRead.value.items : [];
  if (remoteRead.status === "rejected") {
    failure(
      report.failures,
      "remote_link",
      issue.id,
      "read",
      "remote_link_catalog_read_failed",
      remoteRead.reason,
    );
  }
  const attachments = issue.attachments;
  const attachmentCatalogPresent = input.issue.fields.attachment !== undefined;
  const links = issue.links;
  const returnedAttachmentIds = new Set(
    attachments.map((attachment) => attachment.id),
  );
  const missingAttachmentBindings = input.ledger.bindings.filter(
    (binding) =>
      binding.source_identity.entity_kind === "attachment" &&
      binding.source_identity.jira_cloud_id === input.jiraCloudId &&
      (binding.source_identity.issue_id === undefined ||
        binding.source_identity.issue_id === issue.id) &&
      (!attachmentAclEstablished ||
        (attachmentCatalogPresent &&
          !returnedAttachmentIds.has(binding.source_identity.attachment_id))),
  );
  report.comments.total = comments.length;
  report.comments.roots = comments.filter(
    (item) => item.parentId == null,
  ).length;
  report.comments.replies = comments.length - report.comments.roots;
  report.attachments.total = attachments.length;
  report.links.entries = links.length;
  report.remote_links.total = remoteLinks.length;
  const plannedCommentTargets = new Map<string, string>();
  const now = input.now ?? (() => new Date().toISOString());
  const unsafeCommentSourceKeys = new Set(
    [...unsafeCommentIds].map(
      (commentId) =>
        jiraCommentSourceIdentity(input.jiraCloudId, issue.id, commentId).key,
    ),
  );
  const attachmentResult = await importAttachments({
    migration,
    issueId: issue.id,
    comments,
    unsafeCommentIds,
    attachments,
    attachmentAclEstablished,
    attachmentBytePolicyInvalid,
    attachmentCatalogPresent,
    sourceLedger: input.ledger,
    ledger,
    report,
    now,
  });
  ledger = attachmentResult.ledger;
  const attachmentBindings = attachmentResult.attachmentBindings;
  if (input.mode === "apply" && input.checkpointLedger) {
    await input.checkpointLedger(ledger);
  }

  await updateDescriptionMedia({
    migration,
    issueId: issue.id,
    descriptionAdf: issue.description,
    attachments,
    attachmentBindings,
    recordOperation,
    report,
  });

  ledger = await importComments({
    migration,
    issueId: issue.id,
    comments,
    unsafeVisibilityCommentIds,
    unsafeCommentSourceKeys,
    plannedCommentTargets,
    attachmentBindings,
    attachments,
    ledger,
    recordOperation,
    report,
    now,
  });

  ledger = await importIssueLinks({
    migration,
    issueId: issue.id,
    issueKey: issue.key,
    projectKey: issue.projectKey ?? issue.key.split("-", 1)[0] ?? issue.key,
    linkCatalogPresent: input.issue.fields.issuelinks !== undefined,
    links,
    ledger,
    report,
    now,
  });

  await importRemoteLinks({
    migration,
    issueId: issue.id,
    catalogReadSucceeded: remoteRead.status === "fulfilled",
    remoteLinks,
    report,
  });

  if (approvalViolations.size > 0) {
    throw new Error(
      `related_operation_not_approved:${[...approvalViolations].join(",")}`,
    );
  }
  return { ledger, report };
}
