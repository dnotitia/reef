import type { Comment, ExternalRef, IssueAttachment } from "@reef/core";
import type {
  JiraAccountMappingArtifact,
  ReefActorDirectoryEntry,
} from "../accounts/mapping.js";
import type { AdfToMarkdownOptions } from "../content/adf.js";
import type { JiraReadClient } from "../jira/client.js";
import type { JiraMigrationLedgerV1 } from "../ledger.js";
import type {
  JiraIssuePayload,
  NormalizedJiraAttachment,
} from "../payloads.js";

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

export type JiraRelatedOperationKind =
  | "create_comment"
  | "update_comment"
  | "delete_comment"
  | "create_attachment"
  | "revoke_attachment"
  | "update_description"
  | "put_relation"
  | "delete_relation"
  | "put_external_ref"
  | "delete_external_ref";

export interface JiraRelatedOperation {
  kind: JiraRelatedOperationKind;
  key_sha256: string;
  input_sha256: string;
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
  updateComment(
    commentId: string,
    input: JiraImportedCommentInput,
  ): Promise<Comment>;
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
    jiraCloudId: string,
    jiraAttachmentId: string,
  ): Promise<{ attachment: IssueAttachment; bytes: Uint8Array } | null>;
  revokeAttachment(input: {
    reefId: string;
    fileUri: string;
    replacement: string;
  }): Promise<void>;
  hasMediaReference(reefId: string, fileUri: string): Promise<boolean>;
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
  listExternalRefKeys(prefix: string): Promise<string[]>;
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
    commentVisibilityCompleteness?: "verified";
    approvedCommentBindings?: readonly JiraMigrationLedgerV1["bindings"][number][];
    approvedCommentBindingsAppliedAfter?: string;
    maxBytes: number;
  };
  descriptionConversionOptions?: AdfToMarkdownOptions;
  resolveIssueTarget(
    sourceIdOrKey: string,
  ): { reefId: string; documentUri: string } | null;
  preserveUnresolvedIssueTargets?: ReadonlySet<string>;
  mode: "dry-run" | "apply";
  now?: () => string;
  checkpointLedger?(ledger: JiraMigrationLedgerV1): Promise<void>;
  approvedOperations?: readonly JiraRelatedOperation[];
}

export interface JiraRelatedImportReport {
  mode: "dry-run" | "apply";
  deletions: number;
  comments: {
    total: number;
    roots: number;
    replies: number;
    created: number;
    updated: number;
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
    description_updated: boolean;
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
  operations: JiraRelatedOperation[];
  failures: JiraRelatedImportFailure[];
}

export interface JiraRelatedImportResult {
  ledger: JiraMigrationLedgerV1;
  report: JiraRelatedImportReport;
}

export interface AttachmentBinding {
  source: NormalizedJiraAttachment;
  fileUri: string;
}
