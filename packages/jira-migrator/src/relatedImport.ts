import type { Comment, ExternalRef, IssueAttachment } from "@reef/core";
import type {
  JiraAccountMappingArtifact,
  ReefActorDirectoryEntry,
} from "./accountMapping.js";
import { mapJiraCommentActor } from "./accountMapping.js";
import { type AdfMediaReference, convertAdfToMarkdown } from "./adf.js";
import { fingerprintJiraState } from "./diff.js";
import type { JiraReadClient } from "./jiraClient.js";
import {
  type JiraMigrationLedgerV1,
  confirmJiraMigrationBinding,
  getJiraCommentTargetId,
  jiraAttachmentSourceIdentity,
  jiraCommentSourceIdentity,
  jiraRelationSourceIdentity,
  legacyJiraRelationSourceKey,
} from "./ledger.js";
import type {
  JiraCommentPayload,
  JiraIssuePayload,
  JiraRemoteLinkPayload,
  NormalizedJiraAttachment,
  NormalizedJiraIssueLink,
} from "./payloads.js";
import { normalizeJiraIssue } from "./payloads.js";

export type JiraRelationKind = "blocks" | "depends_on" | "related_to";

interface JiraLinkMappingMatch {
  typeId?: string;
  name?: string;
  inward?: string;
  outward?: string;
}

export type JiraLinkMapping = JiraLinkMappingMatch &
  (
    | {
        kind: "directional";
        outwardRelation: "blocks" | "depends_on";
        inwardRelation: "blocks" | "depends_on";
      }
    | { kind: "symmetric" }
  );

export interface JiraRelatedImportFailure {
  source_kind: "comment" | "attachment" | "media" | "link" | "remote_link";
  source_id: string;
  phase: "read" | "resolve" | "write" | "readback";
  retryable: boolean;
  reason: string;
}

export interface JiraImportedCommentInput {
  reefId: string;
  body: string;
  author: string;
  createdAt: string;
  editedAt: string | null;
  parentCommentId?: string;
}

export interface JiraImportedAttachmentInput {
  idempotencyKey: string;
  reefId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  author: string;
  createdAt: string;
  originalJiraAttachmentId: string;
  meta: Record<string, unknown>;
}

export interface JiraRelatedImportTarget {
  createComment(input: JiraImportedCommentInput): Promise<Comment>;
  readComment(commentId: string): Promise<Comment | null>;
  createAttachment(
    input: JiraImportedAttachmentInput,
  ): Promise<IssueAttachment>;
  readAttachment(
    fileUri: string,
  ): Promise<{ attachment: IssueAttachment; bytes: Uint8Array } | null>;
  findAttachmentByJiraId(
    reefId: string,
    jiraAttachmentId: string,
  ): Promise<{ attachment: IssueAttachment; bytes: Uint8Array } | null>;
  updateDescription(reefId: string, markdown: string): Promise<void>;
  putRelation(input: {
    idempotencyKey: string;
    sourceReefId: string;
    targetReefId: string;
    relation: JiraRelationKind;
    inverseRelation: JiraRelationKind;
    provenance: Record<string, unknown>;
  }): Promise<void>;
  hasRelation(idempotencyKey: string): Promise<boolean>;
  putExternalRef(input: {
    idempotencyKey: string;
    reefId: string;
    ref: ExternalRef;
    provenance: Record<string, unknown>;
  }): Promise<void>;
  hasExternalRef(idempotencyKey: string): Promise<boolean>;
}

export interface JiraRelatedImportInput {
  jiraCloudId: string;
  issue: JiraIssuePayload;
  reefId: string;
  client: JiraReadClient;
  target: JiraRelatedImportTarget;
  ledger: JiraMigrationLedgerV1;
  accountMapping: JiraAccountMappingArtifact;
  actorDirectory?: readonly ReefActorDirectoryEntry[];
  linkMappings: readonly JiraLinkMapping[];
  resolveIssueTarget(
    sourceIdOrKey: string,
  ): { reefId: string; documentUri: string } | null;
  mode: "dry-run" | "apply";
  now?: () => string;
}

export interface JiraRelatedImportReport {
  mode: "dry-run" | "apply";
  comments: {
    total: number;
    roots: number;
    replies: number;
    created: number;
    skipped: number;
    flat_fallback: 0;
  };
  attachments: {
    total: number;
    created: number;
    skipped: number;
    bytes: number;
  };
  media: {
    total: number;
    rewritten: number;
    unresolved: number;
    by_strategy: Record<string, number>;
  };
  links: {
    entries: number;
    unique: number;
    applied: number;
    skipped: number;
    unresolved: number;
  };
  remote_links: { total: number; applied: number; skipped: number };
  failures: JiraRelatedImportFailure[];
}

export interface JiraRelatedImportResult {
  ledger: JiraMigrationLedgerV1;
  report: JiraRelatedImportReport;
}

interface AttachmentBinding {
  source: NormalizedJiraAttachment;
  fileUri: string;
}

const validAttachmentReadback = (
  readback: {
    attachment: IssueAttachment;
    bytes: Uint8Array;
  } | null,
  source: NormalizedJiraAttachment,
  expectedByteLength = source.size,
): boolean =>
  readback !== null &&
  readback.attachment.original_jira_attachment_id === source.id &&
  readback.attachment.filename === source.filename &&
  readback.attachment.size_bytes === readback.bytes.byteLength &&
  (expectedByteLength === null ||
    readback.bytes.byteLength === expectedByteLength);

const retryableError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "retryable" in error &&
  error.retryable === true;

const failure = (
  failures: JiraRelatedImportFailure[],
  source_kind: JiraRelatedImportFailure["source_kind"],
  source_id: string,
  phase: JiraRelatedImportFailure["phase"],
  reason: string,
  error?: unknown,
): void => {
  failures.push({
    source_kind,
    source_id,
    phase,
    reason,
    retryable: retryableError(error),
  });
};

const sameLinkMapping = (
  mapping: JiraLinkMapping,
  link: NormalizedJiraIssueLink,
): boolean =>
  (mapping.typeId !== undefined ||
    (mapping.name !== undefined &&
      mapping.inward !== undefined &&
      mapping.outward !== undefined)) &&
  (mapping.typeId === undefined || mapping.typeId === link.typeId) &&
  (mapping.name === undefined || mapping.name === link.type) &&
  (mapping.inward === undefined || mapping.inward === link.inward) &&
  (mapping.outward === undefined || mapping.outward === link.outward);

const canonicalRemoteLinkIdentity = (remote: JiraRemoteLinkPayload): string =>
  remote.globalId ??
  `sha256:${fingerprintJiraState({ application: remote.application ?? null, object: remote.object, relationship: remote.relationship ?? null })}`;

const renderedHints = (
  html: string,
): Map<string, { attachmentId: string | null; filename: string | null }> => {
  const hints = new Map<
    string,
    { attachmentId: string | null; filename: string | null }
  >();
  for (const match of html.matchAll(
    /<[^>]*data-media-services-id=["']([^"']+)["'][^>]*>/giu,
  )) {
    const tag = match[0];
    const mediaId = match[1];
    if (!mediaId) continue;
    const href =
      tag.match(/(?:attachment\/|att)(\d+)(?:\/|[?"'])/iu)?.[1] ?? null;
    const name =
      tag.match(/(?:data-filename|alt|title)=["']([^"']+)["']/iu)?.[1] ?? null;
    hints.set(mediaId, { attachmentId: href, filename: name });
  }
  return hints;
};

export type JiraMediaResolutionStrategy =
  | "unique_filename"
  | "sole_attachment"
  | "rendered_element"
  | "rendered_unique_filename";

export const canonicalizeJiraRelation = (
  mapping: JiraLinkMapping,
  direction: NormalizedJiraIssueLink["direction"],
  currentReefId: string,
  linkedReefId: string,
): {
  sourceReefId: string;
  targetReefId: string;
  relation: JiraRelationKind;
  inverseRelation: JiraRelationKind;
} => {
  if (mapping.kind === "symmetric") {
    return {
      sourceReefId: currentReefId,
      targetReefId: linkedReefId,
      relation: "related_to",
      inverseRelation: "related_to",
    };
  }
  return {
    sourceReefId: direction === "outward" ? linkedReefId : currentReefId,
    targetReefId: direction === "outward" ? currentReefId : linkedReefId,
    relation: mapping.outwardRelation,
    inverseRelation: mapping.inwardRelation,
  };
};

const validCommentReadback = (
  readback: Comment | null,
  expected: JiraImportedCommentInput,
): boolean =>
  readback !== null &&
  readback.reef_id === expected.reefId &&
  readback.body === expected.body &&
  readback.author === expected.author &&
  readback.created_at === expected.createdAt &&
  readback.edited_at === expected.editedAt &&
  readback.parent_comment_id === (expected.parentCommentId ?? null) &&
  (expected.parentCommentId === undefined || readback.thread_root_id !== null);

export const resolveJiraMediaReference = (
  media: AdfMediaReference,
  attachments: readonly AttachmentBinding[],
  renderedHtml: string,
): {
  binding: AttachmentBinding;
  strategy: JiraMediaResolutionStrategy;
} | null => {
  if (media.filename) {
    const candidates = attachments.filter(
      (item) => item.source.filename === media.filename,
    );
    if (candidates.length === 1)
      return { binding: candidates[0], strategy: "unique_filename" };
    if (candidates.length > 1) return null;
  }
  if (attachments.length === 1)
    return { binding: attachments[0], strategy: "sole_attachment" };
  const hint = renderedHints(renderedHtml).get(media.mediaId);
  if (!hint) return null;
  if (hint.attachmentId) {
    const candidates = attachments.filter(
      (item) => item.source.id === hint.attachmentId,
    );
    if (candidates.length === 1)
      return { binding: candidates[0], strategy: "rendered_element" };
    if (candidates.length > 1) return null;
  }
  if (hint.filename) {
    const candidates = attachments.filter(
      (item) => item.source.filename === hint.filename,
    );
    if (candidates.length === 1)
      return { binding: candidates[0], strategy: "rendered_unique_filename" };
  }
  return null;
};

const rewriteMedia = (
  adf: unknown,
  bindings: readonly AttachmentBinding[],
  renderedHtml: string,
  report: JiraRelatedImportReport,
  sourceId: string,
): { markdown: string; resolved: boolean } => {
  const converted = convertAdfToMarkdown(adf);
  let markdown = converted.markdown;
  let resolved = true;
  for (const media of converted.media) {
    report.media.total += 1;
    const resolution = resolveJiraMediaReference(media, bindings, renderedHtml);
    if (!resolution) {
      resolved = false;
      report.media.unresolved += 1;
      failure(
        report.failures,
        "media",
        `${sourceId}:${media.mediaId}`,
        "resolve",
        "media_crosswalk_unresolved_or_ambiguous",
      );
      continue;
    }
    markdown = markdown
      .split(media.placeholder)
      .join(resolution.binding.fileUri);
    report.media.rewritten += 1;
    report.media.by_strategy[resolution.strategy] =
      (report.media.by_strategy[resolution.strategy] ?? 0) + 1;
  }
  return { markdown, resolved };
};

const reportTemplate = (
  mode: "dry-run" | "apply",
): JiraRelatedImportReport => ({
  mode,
  comments: {
    total: 0,
    roots: 0,
    replies: 0,
    created: 0,
    skipped: 0,
    flat_fallback: 0,
  },
  attachments: { total: 0, created: 0, skipped: 0, bytes: 0 },
  media: { total: 0, rewritten: 0, unresolved: 0, by_strategy: {} },
  links: { entries: 0, unique: 0, applied: 0, skipped: 0, unresolved: 0 },
  remote_links: { total: 0, applied: 0, skipped: 0 },
  failures: [],
});

export async function importJiraRelatedData(
  input: JiraRelatedImportInput,
): Promise<JiraRelatedImportResult> {
  const report = reportTemplate(input.mode);
  const issue = normalizeJiraIssue(input.issue);
  const [commentsRead, remoteRead] = await Promise.allSettled([
    input.client.readComments(issue.key),
    input.client.listRemoteLinks(issue.key),
  ]);
  const comments =
    commentsRead.status === "fulfilled" ? commentsRead.value.items : [];
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
  const links = issue.links;
  report.comments.total = comments.length;
  report.comments.roots = comments.filter(
    (item) => item.parentId == null,
  ).length;
  report.comments.replies = comments.length - report.comments.roots;
  report.attachments.total = attachments.length;
  report.links.entries = links.length;
  report.remote_links.total = remoteLinks.length;
  let ledger = input.ledger;
  const attachmentBindings: AttachmentBinding[] = [];
  const plannedCommentTargets = new Map<string, string>();
  const now = input.now ?? (() => new Date().toISOString());

  for (const attachment of attachments) {
    const identity = jiraAttachmentSourceIdentity(
      input.jiraCloudId,
      attachment.id,
    );
    const existing = ledger.bindings.find(
      (item) => item.source_key === identity.key,
    );
    try {
      if (existing?.target.target_kind === "attachment") {
        const readback = await input.target.readAttachment(
          existing.target.file_uri,
        );
        if (!validAttachmentReadback(readback, attachment))
          throw new Error("attachment_readback_mismatch");
        attachmentBindings.push({
          source: attachment,
          fileUri: existing.target.file_uri,
        });
        report.attachments.skipped += 1;
        continue;
      }
      const recovered = await input.target.findAttachmentByJiraId(
        input.reefId,
        attachment.id,
      );
      if (recovered) {
        if (!validAttachmentReadback(recovered, attachment))
          throw new Error("attachment_readback_mismatch");
        attachmentBindings.push({
          source: attachment,
          fileUri: recovered.attachment.file_uri,
        });
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
        report.attachments.skipped += 1;
        continue;
      }
      if (input.mode === "dry-run") {
        attachmentBindings.push({
          source: attachment,
          fileUri: `dry-run://attachment/${encodeURIComponent(attachment.id)}`,
        });
        continue;
      }
      const download = await input.client.downloadAttachmentContent(
        attachment.id,
      );
      if (
        attachment.size !== null &&
        download.bytes.byteLength !== attachment.size
      )
        throw new Error("attachment_size_mismatch");
      const mappedAuthor = attachment.author?.accountId
        ? input.accountMapping.accounts[attachment.author.accountId]?.actor
        : null;
      const created = await input.target.createAttachment({
        idempotencyKey: identity.key,
        reefId: input.reefId,
        filename: attachment.filename,
        mimeType:
          attachment.mimeType ??
          download.contentType ??
          "application/octet-stream",
        bytes: download.bytes,
        author: mappedAuthor ?? "jira-import",
        createdAt: attachment.created ?? now(),
        originalJiraAttachmentId: attachment.id,
        meta: { source: "jira", jira_cloud_id: input.jiraCloudId },
      });
      const readback = await input.target.readAttachment(created.file_uri);
      if (
        !validAttachmentReadback(
          readback,
          attachment,
          download.bytes.byteLength,
        )
      )
        throw new Error("attachment_readback_mismatch");
      report.attachments.bytes += download.bytes.byteLength;
      report.attachments.created += 1;
      attachmentBindings.push({
        source: attachment,
        fileUri: created.file_uri,
      });
      const sourceFingerprint = fingerprintJiraState(attachment);
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
    } catch (error) {
      failure(
        report.failures,
        "attachment",
        attachment.id,
        String(error).includes("readback") ? "readback" : "write",
        String(error).includes("size_mismatch")
          ? "attachment_size_mismatch"
          : "attachment_import_failed",
        error,
      );
    }
  }

  const renderedDescription =
    typeof input.issue.renderedFields?.description === "string"
      ? input.issue.renderedFields.description
      : "";
  const description = rewriteMedia(
    issue.description,
    attachmentBindings,
    renderedDescription,
    report,
    issue.id,
  );
  if (input.mode === "apply" && description.resolved) {
    try {
      await input.target.updateDescription(input.reefId, description.markdown);
    } catch (error) {
      failure(
        report.failures,
        "media",
        issue.id,
        "write",
        "description_media_write_failed",
        error,
      );
    }
  }

  const roots = comments.filter((item) => item.parentId == null);
  const replies = comments.filter((item) => item.parentId != null);
  for (const comment of [...roots, ...replies]) {
    const identity = jiraCommentSourceIdentity(
      input.jiraCloudId,
      issue.id,
      comment.id,
    );
    const parentSourceId = comment.parentId ?? null;
    const parentTargetId =
      parentSourceId === null
        ? null
        : (getJiraCommentTargetId(
            ledger,
            jiraCommentSourceIdentity(
              input.jiraCloudId,
              issue.id,
              parentSourceId,
            ),
          ) ??
          plannedCommentTargets.get(parentSourceId) ??
          null);
    if (parentSourceId !== null && parentTargetId === null) {
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
      );
      if (!body.resolved) continue;
      const existingTarget = getJiraCommentTargetId(ledger, identity);
      if (existingTarget) {
        const existing = await input.target.readComment(existingTarget);
        if (!existing) throw new Error("comment_readback_missing");
        report.comments.skipped += 1;
        continue;
      }
      if (input.mode === "dry-run") {
        plannedCommentTargets.set(comment.id, `dry-run-comment:${comment.id}`);
        continue;
      }
      const actor = mapJiraCommentActor(comment, {
        artifact: input.accountMapping,
        directory: input.actorDirectory ?? [],
      });
      const commentInput: JiraImportedCommentInput = {
        reefId: input.reefId,
        body: body.markdown,
        author: actor.actor ?? "jira-import",
        createdAt: comment.created ?? now(),
        editedAt:
          comment.updated && comment.updated !== comment.created
            ? comment.updated
            : null,
        ...(parentTargetId ? { parentCommentId: parentTargetId } : {}),
      };
      const created = await input.target.createComment(commentInput);
      const readback = await input.target.readComment(created.id);
      if (!validCommentReadback(readback, commentInput))
        throw new Error("comment_readback_mismatch");
      ledger = confirmJiraMigrationBinding(ledger, {
        sourceIdentity: identity,
        target: { target_kind: "comment", comment_id: created.id },
        sourceFingerprint: fingerprintJiraState(comment),
        mappedStateFingerprint: fingerprintJiraState({
          body: body.markdown,
          author: actor.actor,
          parent: parentTargetId,
        }),
        lastAppliedAt: now(),
        writeSucceeded: true,
        readbackSucceeded: true,
      });
      report.comments.created += 1;
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

  const uniqueLinks = new Map<string, NormalizedJiraIssueLink>();
  for (const link of links) {
    if (!link.id) {
      failure(
        report.failures,
        "link",
        "missing",
        "resolve",
        "jira_link_id_missing",
      );
      continue;
    }
    uniqueLinks.set(link.id, link);
  }
  report.links.unique = uniqueLinks.size;
  for (const [linkId, link] of uniqueLinks) {
    try {
      const mapping = input.linkMappings.find((item) =>
        sameLinkMapping(item, link),
      );
      const targetIssue = input.resolveIssueTarget(
        link.issueId ?? link.issueKey,
      );
      if (!mapping || !targetIssue) {
        report.links.unresolved += 1;
        if (input.mode === "apply") {
          const externalKey = `jira-link:${input.jiraCloudId}:${linkId}`;
          if (await input.target.hasExternalRef(externalKey)) {
            report.links.skipped += 1;
            continue;
          }
          await input.target.putExternalRef({
            idempotencyKey: externalKey,
            reefId: input.reefId,
            ref: { type: "jira", ref: link.issueKey, label: "Jira issue link" },
            provenance: {
              source: "jira",
              link_id: linkId,
              type: {
                id: link.typeId,
                name: link.type,
                inward: link.inward,
                outward: link.outward,
              },
              unresolved: true,
            },
          });
        }
        continue;
      }
      if (input.mode === "dry-run") continue;
      const { relation, inverseRelation, sourceReefId, targetReefId } =
        canonicalizeJiraRelation(
          mapping,
          link.direction,
          input.reefId,
          targetIssue.reefId,
        );
      const targetIssueId = link.issueId ?? link.issueKey;
      const linkType = link.typeId ?? link.type ?? "unknown";
      const identity = jiraRelationSourceIdentity(
        input.jiraCloudId,
        issue.id,
        targetIssueId,
        linkType,
        link.direction,
        linkId,
      );
      const legacyKey = legacyJiraRelationSourceKey(
        input.jiraCloudId,
        issue.id,
        targetIssueId,
        linkType,
        link.direction,
        linkId,
      );
      const mappedStateFingerprint = fingerprintJiraState({
        source: sourceReefId,
        target: targetReefId,
        relation,
        inverseRelation,
      });
      const existingBinding = ledger.bindings.find(
        (item) =>
          item.source_key === identity.key || item.source_key === legacyKey,
      );
      if (
        existingBinding?.target.target_kind === "relation" &&
        existingBinding.mapped_state_fingerprint === mappedStateFingerprint &&
        (await input.target.hasRelation(existingBinding.target.idempotency_key))
      ) {
        report.links.skipped += 1;
        continue;
      }
      const relationKey =
        existingBinding?.target.target_kind === "relation"
          ? existingBinding.target.idempotency_key
          : identity.key;
      await input.target.putRelation({
        idempotencyKey: relationKey,
        sourceReefId,
        targetReefId,
        relation,
        inverseRelation,
        provenance: { source: "jira", link_id: linkId },
      });
      if (!(await input.target.hasRelation(relationKey)))
        throw new Error("relation_readback_missing");
      ledger = confirmJiraMigrationBinding(ledger, {
        sourceIdentity: existingBinding?.source_identity ?? identity,
        target: { target_kind: "relation", idempotency_key: relationKey },
        sourceFingerprint: fingerprintJiraState(link),
        mappedStateFingerprint,
        lastAppliedAt: now(),
        writeSucceeded: true,
        readbackSucceeded: true,
      });
      report.links.applied += 1;
    } catch (error) {
      failure(
        report.failures,
        "link",
        linkId,
        String(error).includes("readback") ? "readback" : "write",
        "link_import_failed",
        error,
      );
    }
  }

  for (const remote of remoteLinks) {
    const remoteId = canonicalRemoteLinkIdentity(remote);
    const url = remote.object.url;
    if (!url) {
      failure(
        report.failures,
        "remote_link",
        remoteId,
        "resolve",
        "remote_link_url_missing",
      );
      continue;
    }
    if (input.mode === "apply") {
      try {
        const idempotencyKey = `jira-remote:${input.jiraCloudId}:${remoteId}`;
        if (await input.target.hasExternalRef(idempotencyKey)) {
          report.remote_links.skipped += 1;
          continue;
        }
        await input.target.putExternalRef({
          idempotencyKey,
          reefId: input.reefId,
          ref: { type: "url", url, label: remote.object.title },
          provenance: {
            source: "jira",
            remote_identity: remoteId,
            global_id: remote.globalId ?? null,
            application: remote.application ?? null,
            relationship: remote.relationship ?? null,
            object: remote.object,
          },
        });
        report.remote_links.applied += 1;
      } catch (error) {
        failure(
          report.failures,
          "remote_link",
          remoteId,
          "write",
          "remote_link_import_failed",
          error,
        );
      }
    }
  }

  return { ledger, report };
}
