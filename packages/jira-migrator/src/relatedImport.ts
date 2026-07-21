import type { Comment, ExternalRef, IssueAttachment } from "@reef/core";
import type {
  JiraAccountMappingArtifact,
  ReefActorDirectoryEntry,
} from "./accountMapping.js";
import { mapJiraCommentActor, resolveJiraActor } from "./accountMapping.js";
import {
  type AdfMediaReference,
  type AdfToMarkdownOptions,
  convertAdfToMarkdown,
} from "./adf.js";
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
  removeJiraMigrationBindings,
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
  idempotencyKey: string;
  reefId: string;
  body: string;
  author: string;
  createdAt: string;
  editedAt: string | null;
  parentCommentId?: string;
  expectedThreadRootId: string | null;
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
  findCommentByIdempotencyKey(idempotencyKey: string): Promise<Comment | null>;
  deleteComment(commentId: string): Promise<void>;
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
  revokeAttachment(fileUri: string): Promise<void>;
  readDescription(reefId: string): Promise<string>;
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
  readRelation(idempotencyKey: string): Promise<{
    sourceReefId: string;
    targetReefId: string;
    relation: JiraRelationKind;
    inverseRelation: JiraRelationKind;
  } | null>;
  deleteRelation(idempotencyKey: string): Promise<void>;
  putExternalRef(input: {
    idempotencyKey: string;
    reefId: string;
    ref: ExternalRef;
    provenance: Record<string, unknown>;
  }): Promise<void>;
  hasExternalRef(idempotencyKey: string): Promise<boolean>;
  readExternalRef(idempotencyKey: string): Promise<{
    reefId: string;
    ref: ExternalRef;
    provenance: Record<string, unknown>;
  } | null>;
  deleteExternalRef(idempotencyKey: string): Promise<void>;
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
  attachmentPolicy?: {
    commentVisibilityCompleteness: "verified";
    maxBytes: number;
  };
  descriptionConversionOptions?: AdfToMarkdownOptions;
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

const MISSING_SOURCE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

const validAttachmentReadback = (
  readback: {
    attachment: IssueAttachment;
    bytes: Uint8Array;
  } | null,
  source: NormalizedJiraAttachment,
  expected: {
    reefId: string;
    author: string;
    createdAt: string;
    mimeType: string;
    jiraCloudId: string;
  },
  expectedBytes?: Uint8Array,
): boolean =>
  readback !== null &&
  readback.attachment.original_jira_attachment_id === source.id &&
  readback.attachment.reef_id === expected.reefId &&
  readback.attachment.filename === source.filename &&
  readback.attachment.mime_type === expected.mimeType &&
  readback.attachment.author === expected.author &&
  readback.attachment.created_at === expected.createdAt &&
  readback.attachment.source === "jira_import" &&
  readback.attachment.meta?.source === "jira" &&
  readback.attachment.meta?.jira_cloud_id === expected.jiraCloudId &&
  readback.attachment.size_bytes === readback.bytes.byteLength &&
  (source.size === null || readback.bytes.byteLength === source.size) &&
  (expectedBytes === undefined ||
    (readback.bytes.byteLength === expectedBytes.byteLength &&
      readback.bytes.every((byte, index) => byte === expectedBytes[index])));

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

const jiraCommentVisibility = (
  comment: JiraCommentPayload,
): "safe" | "restricted" | "unverified" => {
  if (comment.visibility !== undefined) return "restricted";
  if (comment.properties === undefined) return "unverified";
  const serviceManagementVisibility = comment.properties.find(
    (property) => property.key === "sd.public.comment",
  );
  if (!serviceManagementVisibility) return "safe";
  const value = serviceManagementVisibility.value;
  if (typeof value !== "object" || value === null || !("internal" in value))
    return "unverified";
  return value.internal === false ? "safe" : "restricted";
};

const canonicalRemoteLinkIdentity = (remote: JiraRemoteLinkPayload): string =>
  remote.globalId
    ? `global:${remote.globalId}`
    : `content-sha256:${fingerprintJiraState({ application: remote.application ?? null, object: remote.object, relationship: remote.relationship ?? null })}`;

const decodeHtmlAttribute = (value: string): string =>
  value.replace(
    /&(?:amp|quot|apos|lt|gt|#39|#x27);/giu,
    (entity) =>
      ({
        "&amp;": "&",
        "&quot;": '"',
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&#39;": "'",
        "&#x27;": "'",
      })[entity.toLowerCase()] ?? entity,
  );

const renderedHints = (
  html: string,
): Map<
  string,
  { attachmentId: string | null; filename: string | null } | null
> => {
  const hints = new Map<
    string,
    { attachmentId: string | null; filename: string | null } | null
  >();
  for (const match of html.matchAll(
    /<[^>]*data-media-services-id=["']([^"']+)["'][^>]*>/giu,
  )) {
    const tag = match[0];
    const mediaId = match[1];
    if (!mediaId) continue;
    const href =
      tag.match(/(?:attachment\/|att)(\d+)(?:\/|[?"'])/iu)?.[1] ?? null;
    const encodedName =
      tag.match(/(?:data-filename|alt|title)=["']([^"']+)["']/iu)?.[1] ?? null;
    const hint = {
      attachmentId: href,
      filename: encodedName ? decodeHtmlAttribute(encodedName) : null,
    };
    const existing = hints.get(mediaId);
    hints.set(
      mediaId,
      existing === undefined ||
        (existing !== null &&
          existing.attachmentId === hint.attachmentId &&
          existing.filename === hint.filename)
        ? hint
        : null,
    );
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
    const [sourceReefId, targetReefId] = [currentReefId, linkedReefId].sort();
    return {
      sourceReefId,
      targetReefId,
      relation: "related_to",
      inverseRelation: "related_to",
    };
  }
  return {
    sourceReefId: direction === "outward" ? currentReefId : linkedReefId,
    targetReefId: direction === "outward" ? linkedReefId : currentReefId,
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
  readback.thread_root_id === expected.expectedThreadRootId;

export const resolveJiraMediaReference = (
  media: AdfMediaReference,
  attachments: readonly AttachmentBinding[],
  renderedHtml: string,
  sourceAttachments: readonly NormalizedJiraAttachment[] = attachments.map(
    (item) => item.source,
  ),
): {
  binding: AttachmentBinding;
  strategy: JiraMediaResolutionStrategy;
} | null => {
  if (media.mediaType !== "file") return null;
  const hint = renderedHints(renderedHtml).get(media.mediaId);
  if (media.filename) {
    const candidates = sourceAttachments.filter(
      (item) => item.filename === media.filename,
    );
    if (candidates.length === 1) {
      const binding = attachments.find(
        (item) => item.source.id === candidates[0]?.id,
      );
      return binding ? { binding, strategy: "unique_filename" } : null;
    }
  }
  if (sourceAttachments.length === 1) {
    const binding = attachments.find(
      (item) => item.source.id === sourceAttachments[0]?.id,
    );
    return binding ? { binding, strategy: "sole_attachment" } : null;
  }
  if (!hint) return null;
  if (hint.attachmentId) {
    const candidates = sourceAttachments.filter(
      (item) => item.id === hint.attachmentId,
    );
    if (candidates.length === 1) {
      const binding = attachments.find(
        (item) => item.source.id === candidates[0]?.id,
      );
      return binding ? { binding, strategy: "rendered_element" } : null;
    }
    if (candidates.length > 1) return null;
  }
  if (hint.filename) {
    const candidates = sourceAttachments.filter(
      (item) => item.filename === hint.filename,
    );
    if (candidates.length === 1) {
      const binding = attachments.find(
        (item) => item.source.id === candidates[0]?.id,
      );
      return binding ? { binding, strategy: "rendered_unique_filename" } : null;
    }
  }
  return null;
};

const rewriteMedia = (
  adf: unknown,
  bindings: readonly AttachmentBinding[],
  renderedHtml: string,
  report: JiraRelatedImportReport,
  sourceId: string,
  sourceAttachments: readonly NormalizedJiraAttachment[],
  conversionOptions: AdfToMarkdownOptions = {},
): {
  markdown: string;
  preRewriteMarkdown: string;
  legacyPreRewriteMarkdown: string;
  resolved: boolean;
  changed: boolean;
} => {
  const converted = convertAdfToMarkdown(adf, conversionOptions);
  let markdown = converted.markdown;
  let legacyPreRewriteMarkdown = converted.markdown;
  let resolved = true;
  for (const media of converted.media) {
    legacyPreRewriteMarkdown = legacyPreRewriteMarkdown.replace(
      media.placeholder,
      media.legacyPlaceholder,
    );
    report.media.total += 1;
    const resolution = resolveJiraMediaReference(
      media,
      bindings,
      renderedHtml,
      sourceAttachments,
    );
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
  return {
    markdown,
    preRewriteMarkdown: converted.markdown,
    legacyPreRewriteMarkdown,
    resolved,
    changed: markdown !== converted.markdown,
  };
};

const reconcileProvisionalLinkRefs = async (
  target: JiraRelatedImportTarget,
  jiraCloudId: string,
  linkId: string,
  endpointIssueIds: readonly (string | null)[],
): Promise<void> => {
  const keys = new Set(
    endpointIssueIds
      .filter((issueId): issueId is string => issueId !== null)
      .map((issueId) => `jira-link:${jiraCloudId}:${issueId}:${linkId}`),
  );
  for (const key of keys) {
    const existing = await target.readExternalRef(key);
    if (!existing) continue;
    if (
      existing.provenance.source !== "jira" ||
      existing.provenance.link_id !== linkId ||
      existing.provenance.unresolved !== true
    )
      throw new Error("external_ref_reconciliation_mismatch");
    await target.deleteExternalRef(key);
    if ((await target.readExternalRef(key)) !== null)
      throw new Error("external_ref_delete_readback_mismatch");
  }
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
  const attachmentVisibilityEstablished =
    input.attachmentPolicy?.commentVisibilityCompleteness === "verified" &&
    Number.isSafeInteger(input.attachmentPolicy.maxBytes) &&
    input.attachmentPolicy.maxBytes > 0 &&
    commentsRead.status === "fulfilled" &&
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
    if (!attachmentVisibilityEstablished) {
      if (input.mode === "apply") {
        try {
          const binding = ledger.bindings.find(
            (item) => item.source_key === identity.key,
          );
          const recovered = await input.target.findAttachmentByJiraId(
            input.reefId,
            attachment.id,
          );
          const fileUris = new Set<string>();
          if (binding?.target.target_kind === "attachment")
            fileUris.add(binding.target.file_uri);
          if (recovered) fileUris.add(recovered.attachment.file_uri);
          for (const fileUri of fileUris) {
            await input.target.revokeAttachment(fileUri);
            if ((await input.target.readAttachment(fileUri)) !== null)
              throw new Error("attachment_revocation_readback_mismatch");
          }
          ledger = removeJiraMigrationBindings(ledger, [identity.key]);
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
    const maxAttachmentBytes = input.attachmentPolicy?.maxBytes;
    if (
      maxAttachmentBytes === undefined ||
      (attachment.size !== null && attachment.size > maxAttachmentBytes)
    ) {
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
        artifact: input.accountMapping,
        directory: input.actorDirectory ?? [],
      },
    ).actor;
    const expectedAttachmentBase = {
      reefId: input.reefId,
      author: mappedAuthor ?? "jira-import",
      createdAt: attachment.created ?? MISSING_SOURCE_TIMESTAMP,
      jiraCloudId: input.jiraCloudId,
    };
    let attachmentPhase: JiraRelatedImportFailure["phase"] = "read";
    try {
      if (existing?.target.target_kind === "attachment") {
        const download = await input.client.downloadAttachmentContent(
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
          mimeType:
            attachment.mimeType ??
            download.contentType ??
            "application/octet-stream",
        };
        attachmentPhase = "readback";
        const readback = await input.target.readAttachment(
          existing.target.file_uri,
        );
        if (
          !validAttachmentReadback(
            readback,
            attachment,
            expectedAttachment,
            download.bytes,
          )
        )
          throw new Error("attachment_readback_mismatch");
        attachmentBindings.push({
          source: attachment,
          fileUri: existing.target.file_uri,
        });
        report.attachments.skipped += 1;
        continue;
      }
      attachmentPhase = "readback";
      const recovered = await input.target.findAttachmentByJiraId(
        input.reefId,
        attachment.id,
      );
      if (recovered) {
        attachmentPhase = "read";
        const download = await input.client.downloadAttachmentContent(
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
          mimeType:
            attachment.mimeType ??
            download.contentType ??
            "application/octet-stream",
        };
        attachmentPhase = "readback";
        if (
          !validAttachmentReadback(
            recovered,
            attachment,
            expectedAttachment,
            download.bytes,
          )
        )
          throw new Error("attachment_readback_mismatch");
        attachmentBindings.push({
          source: attachment,
          fileUri: recovered.attachment.file_uri,
        });
        if (input.mode === "apply") {
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
      attachmentPhase = "read";
      const download = await input.client.downloadAttachmentContent(
        attachment.id,
        maxAttachmentBytes,
      );
      if (
        attachment.size !== null &&
        download.bytes.byteLength !== attachment.size
      )
        throw new Error("attachment_size_mismatch");
      if (input.mode === "dry-run") {
        attachmentBindings.push({
          source: attachment,
          fileUri: `dry-run://attachment/${encodeURIComponent(attachment.id)}`,
        });
        continue;
      }
      const mimeType =
        attachment.mimeType ??
        download.contentType ??
        "application/octet-stream";
      attachmentPhase = "write";
      const created = await input.target.createAttachment({
        idempotencyKey: identity.key,
        reefId: input.reefId,
        filename: attachment.filename,
        mimeType,
        bytes: download.bytes,
        author: mappedAuthor ?? "jira-import",
        createdAt: expectedAttachmentBase.createdAt,
        originalJiraAttachmentId: attachment.id,
        meta: { source: "jira", jira_cloud_id: input.jiraCloudId },
      });
      attachmentPhase = "readback";
      const readback = await input.target.readAttachment(created.file_uri);
      if (
        !validAttachmentReadback(
          readback,
          attachment,
          { ...expectedAttachmentBase, mimeType },
          download.bytes,
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
        attachmentPhase,
        String(error).includes("size_mismatch")
          ? "attachment_size_mismatch"
          : String(error).includes("content_length_mismatch")
            ? "attachment_size_mismatch"
            : String(error).includes("size_limit")
              ? "attachment_size_limit_exceeded"
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
    attachments,
    input.descriptionConversionOptions,
  );
  if (input.mode === "apply" && description.resolved && description.changed) {
    try {
      const existingDescription = await input.target.readDescription(
        input.reefId,
      );
      if (
        existingDescription === description.preRewriteMarkdown ||
        existingDescription === description.legacyPreRewriteMarkdown
      )
        await input.target.updateDescription(
          input.reefId,
          description.markdown,
        );
      else if (existingDescription !== description.markdown)
        throw new Error("description_precondition_failed");
      const readback = await input.target.readDescription(input.reefId);
      if (readback !== description.markdown)
        throw new Error("description_readback_mismatch");
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
      input.jiraCloudId,
      issue.id,
      comment.id,
    );
    const visibility = jiraCommentVisibility(comment);
    if (visibility !== "safe") {
      if (input.mode === "apply") {
        try {
          const boundTargetId = getJiraCommentTargetId(ledger, identity);
          const recovered = await input.target.findCommentByIdempotencyKey(
            identity.key,
          );
          const targetId = boundTargetId ?? recovered?.id ?? null;
          if (targetId) {
            await input.target.deleteComment(targetId);
            if ((await input.target.readComment(targetId)) !== null)
              throw new Error("comment_revocation_readback_mismatch");
          }
          ledger = removeJiraMigrationBindings(ledger, [identity.key]);
        } catch (error) {
          failure(
            report.failures,
            "comment",
            comment.id,
            String(error).includes("readback") ? "readback" : "write",
            "comment_visibility_revocation_failed",
            error,
          );
        }
      }
      failure(
        report.failures,
        "comment",
        comment.id,
        "resolve",
        visibility === "restricted"
          ? "comment_visibility_restricted"
          : "comment_visibility_unverified",
      );
      continue;
    }
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
      if (input.mode === "apply") {
        try {
          const boundTargetId = getJiraCommentTargetId(ledger, identity);
          const recovered = await input.target.findCommentByIdempotencyKey(
            identity.key,
          );
          const targetId = boundTargetId ?? recovered?.id ?? null;
          if (targetId) {
            await input.target.deleteComment(targetId);
            if ((await input.target.readComment(targetId)) !== null)
              throw new Error("comment_orphan_revocation_readback_mismatch");
          }
          ledger = removeJiraMigrationBindings(ledger, [identity.key]);
        } catch (error) {
          failure(
            report.failures,
            "comment",
            comment.id,
            String(error).includes("readback") ? "readback" : "write",
            "comment_orphan_revocation_failed",
            error,
          );
        }
      }
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
        artifact: input.accountMapping,
        directory: input.actorDirectory ?? [],
      });
      let expectedThreadRootId: string | null = null;
      if (parentTargetId && !parentTargetId.startsWith("dry-run-comment:")) {
        const parentReadback = await input.target.readComment(parentTargetId);
        if (!parentReadback) throw new Error("comment_parent_readback_missing");
        expectedThreadRootId =
          parentReadback.thread_root_id ?? parentReadback.id;
      }
      const commentInput: JiraImportedCommentInput = {
        idempotencyKey: identity.key,
        reefId: input.reefId,
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
      const existingTarget = getJiraCommentTargetId(ledger, identity);
      if (existingTarget) {
        const existing = await input.target.readComment(existingTarget);
        if (!validCommentReadback(existing, commentInput))
          throw new Error("comment_readback_mismatch");
        report.comments.skipped += 1;
        continue;
      }
      const recovered = await input.target.findCommentByIdempotencyKey(
        identity.key,
      );
      if (recovered) {
        if (!validCommentReadback(recovered, commentInput))
          throw new Error("comment_readback_mismatch");
        plannedCommentTargets.set(comment.id, recovered.id);
        if (input.mode === "apply") {
          ledger = confirmJiraMigrationBinding(ledger, {
            sourceIdentity: identity,
            target: { target_kind: "comment", comment_id: recovered.id },
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
        }
        report.comments.skipped += 1;
        continue;
      }
      if (input.mode === "dry-run") {
        plannedCommentTargets.set(comment.id, `dry-run-comment:${comment.id}`);
        continue;
      }
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
          const staleRelationBindings = ledger.bindings.filter(
            (binding) =>
              binding.source_identity.entity_kind === "relation" &&
              binding.source_identity.jira_cloud_id === input.jiraCloudId &&
              binding.source_identity.link_id === linkId,
          );
          const staleRelationKeys = new Set(
            staleRelationBindings.flatMap((binding) =>
              binding.target.target_kind === "relation"
                ? [binding.target.idempotency_key]
                : [],
            ),
          );
          for (const relationKey of staleRelationKeys) {
            await input.target.deleteRelation(relationKey);
            if ((await input.target.readRelation(relationKey)) !== null)
              throw new Error("relation_mapping_removal_readback_mismatch");
          }
          ledger = removeJiraMigrationBindings(
            ledger,
            staleRelationBindings.map((binding) => binding.source_key),
          );
          const externalKey = `jira-link:${input.jiraCloudId}:${issue.id}:${linkId}`;
          const externalValue = {
            reefId: input.reefId,
            ref: {
              type: "jira" as const,
              ref: link.issueKey,
              label: "Jira issue link",
            },
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
          };
          const existing = await input.target.readExternalRef(externalKey);
          if (
            existing &&
            fingerprintJiraState(existing) ===
              fingerprintJiraState(externalValue)
          ) {
            report.links.skipped += 1;
            continue;
          }
          await input.target.putExternalRef({
            idempotencyKey: externalKey,
            ...externalValue,
          });
          const readback = await input.target.readExternalRef(externalKey);
          if (
            fingerprintJiraState(readback) !==
            fingerprintJiraState(externalValue)
          )
            throw new Error("external_ref_readback_missing");
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
      const expectedRelation = {
        sourceReefId,
        targetReefId,
        relation,
        inverseRelation,
      };
      const semanticBindings = ledger.bindings.filter(
        (item) =>
          item.source_key === identity.key ||
          item.source_key === legacyKey ||
          (item.source_identity.entity_kind === "relation" &&
            item.source_identity.jira_cloud_id === input.jiraCloudId &&
            item.source_identity.link_id === linkId),
      );
      const existingBinding = semanticBindings.find(
        (binding) => binding.source_key === identity.key,
      );
      if (
        semanticBindings.length === 1 &&
        existingBinding?.target.target_kind === "relation"
      ) {
        const existingRelation = await input.target.readRelation(
          existingBinding.target.idempotency_key,
        );
        if (
          existingBinding.mapped_state_fingerprint === mappedStateFingerprint &&
          fingerprintJiraState(existingRelation) ===
            fingerprintJiraState(expectedRelation)
        ) {
          await reconcileProvisionalLinkRefs(
            input.target,
            input.jiraCloudId,
            linkId,
            [issue.id, link.issueId],
          );
          report.links.skipped += 1;
          continue;
        }
      }
      const relationKey = identity.key;
      await input.target.putRelation({
        idempotencyKey: relationKey,
        ...expectedRelation,
        provenance: { source: "jira", link_id: linkId },
      });
      const relationReadback = await input.target.readRelation(relationKey);
      if (
        fingerprintJiraState(relationReadback) !==
        fingerprintJiraState(expectedRelation)
      )
        throw new Error("relation_readback_missing");
      await reconcileProvisionalLinkRefs(
        input.target,
        input.jiraCloudId,
        linkId,
        [issue.id, link.issueId],
      );
      for (const legacyBinding of semanticBindings) {
        if (
          legacyBinding.target.target_kind !== "relation" ||
          legacyBinding.target.idempotency_key === relationKey
        )
          continue;
        await input.target.deleteRelation(legacyBinding.target.idempotency_key);
        if (
          (await input.target.readRelation(
            legacyBinding.target.idempotency_key,
          )) !== null
        )
          throw new Error("relation_legacy_delete_readback_mismatch");
      }
      ledger = removeJiraMigrationBindings(
        ledger,
        semanticBindings.map((binding) => binding.source_key),
      );
      ledger = confirmJiraMigrationBinding(ledger, {
        sourceIdentity: identity,
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
    const remoteReportId = `sha256:${fingerprintJiraState(remoteId)}`;
    const url = remote.object.url;
    if (!url) {
      failure(
        report.failures,
        "remote_link",
        remoteReportId,
        "resolve",
        "remote_link_url_missing",
      );
      continue;
    }
    if (input.mode === "apply") {
      try {
        const idempotencyKey = `jira-remote:${input.jiraCloudId}:${issue.id}:${remoteId}`;
        const remoteValue = {
          reefId: input.reefId,
          ref: { type: "url" as const, url, label: remote.object.title },
          provenance: {
            source: "jira",
            remote_identity: remoteId,
            global_id: remote.globalId ?? null,
            application: remote.application ?? null,
            relationship: remote.relationship ?? null,
            object: remote.object,
          },
        };
        const existing = await input.target.readExternalRef(idempotencyKey);
        if (
          existing &&
          fingerprintJiraState(existing) === fingerprintJiraState(remoteValue)
        ) {
          report.remote_links.skipped += 1;
          continue;
        }
        await input.target.putExternalRef({
          idempotencyKey,
          ...remoteValue,
        });
        const readback = await input.target.readExternalRef(idempotencyKey);
        if (
          fingerprintJiraState(readback) !== fingerprintJiraState(remoteValue)
        )
          throw new Error("external_ref_readback_missing");
        report.remote_links.applied += 1;
      } catch (error) {
        failure(
          report.failures,
          "remote_link",
          remoteReportId,
          String(error).includes("readback") ? "readback" : "write",
          "remote_link_import_failed",
          error,
        );
      }
    }
  }

  return { ledger, report };
}
