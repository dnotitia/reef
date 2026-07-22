export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export const RAW_ARCHIVE_ENTITY_KINDS = [
  "issue",
  "description_adf",
  "changelog_history",
  "watcher_list",
  "comment_source",
  "attachment_source",
  "remote_link",
  "custom_field",
] as const;

export type RawArchiveEntityKind = (typeof RAW_ARCHIVE_ENTITY_KINDS)[number];
export type RawArchiveClassification = "internal" | "restricted_pii";

interface RawArchiveSourceIdentityBase {
  cloud_id: string;
  [key: string]: JsonValue;
}

export interface RawArchiveSourceIdentityByKind {
  issue: RawArchiveSourceIdentityBase & {
    project_key: string;
    issue_id: string;
  };
  description_adf: RawArchiveSourceIdentityBase & {
    issue_id: string;
    entity_kind: "description_adf";
  };
  changelog_history: RawArchiveSourceIdentityBase & {
    issue_id: string;
    history_id: string;
  };
  watcher_list: RawArchiveSourceIdentityBase & {
    issue_id: string;
    entity_kind: "watcher_list";
  };
  comment_source: RawArchiveSourceIdentityBase & {
    issue_id: string;
    comment_id: string;
  };
  attachment_source: RawArchiveSourceIdentityBase & {
    attachment_id: string;
  };
  remote_link: RawArchiveSourceIdentityBase & {
    issue_id: string;
    remote_link_id: string;
  };
  custom_field: RawArchiveSourceIdentityBase & {
    issue_id: string;
    entity_kind: "custom_field";
    field_id: string;
  };
}

export type RawArchiveSourceIdentity<
  Kind extends RawArchiveEntityKind = RawArchiveEntityKind,
> = RawArchiveSourceIdentityByKind[Kind];

export const RAW_ARCHIVE_SOURCE_IDENTITY_REQUIRED_KEYS = {
  issue: ["cloud_id", "project_key", "issue_id"],
  description_adf: ["cloud_id", "issue_id", "entity_kind"],
  changelog_history: ["cloud_id", "issue_id", "history_id"],
  watcher_list: ["cloud_id", "issue_id", "entity_kind"],
  comment_source: ["cloud_id", "issue_id", "comment_id"],
  attachment_source: ["cloud_id", "attachment_id"],
  remote_link: ["cloud_id", "issue_id", "remote_link_id"],
  custom_field: ["cloud_id", "issue_id", "entity_kind", "field_id"],
} as const satisfies Record<RawArchiveEntityKind, readonly string[]>;

export interface RawArchiveSourceScope {
  cloud_id: string;
  project_key: string;
}

export interface RawArchiveSourceEndpoint {
  method: "GET";
  pathname: string;
  pagination?: {
    start_at?: number;
    max_results?: number;
    next_page_token?: string;
  };
}

export interface RawArchiveRetention {
  owner: string;
  retention_until: string;
  policy_ref: string;
}

export type RawArchivePermissionVerification =
  | { kind: "posix_mode"; verified: true }
  | {
      kind: "external_acl";
      verified_by: string;
      verified_at: string;
    };

export interface RawArchiveReference {
  runId: string;
  entryId: string;
  contentSha256: string;
}

export const RawArchiveReferenceSchema = z
  .object({
    runId: z.string().min(1),
    entryId: z.string().min(1),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export interface RawArchiveVersionV1 {
  sha256: string;
  byte_size: number;
  relative_path: string;
  fetched_at: string;
}

export interface RawArchiveEntryV1 {
  entry_id: string;
  entity_kind: RawArchiveEntityKind;
  source_identity: RawArchiveSourceIdentity;
  source_endpoint: RawArchiveSourceEndpoint;
  classification: RawArchiveClassification;
  redaction_status: "not_redacted_verified_no_configured_secret";
  versions: RawArchiveVersionV1[];
  current_sha256: string;
}

export interface RawArchiveManifestV1 {
  schema_version: 1;
  run_id: string;
  source_scope: RawArchiveSourceScope;
  created_at: string;
  retention: RawArchiveRetention;
  permission_verification: RawArchivePermissionVerification;
  entries: RawArchiveEntryV1[];
}

export interface RawArchiveEnvelopeV1 {
  envelope_schema_version: 1;
  manifest_sha256: string;
  manifest: RawArchiveManifestV1;
}

export type RawArchiveErrorCode =
  | "invalid_json_value"
  | "invalid_archive_configuration"
  | "invalid_source_metadata"
  | "entry_metadata_conflict"
  | "secret_material_detected"
  | "permission_violation"
  | "symlink_not_allowed"
  | "path_outside_archive"
  | "lock_conflict"
  | "manifest_missing"
  | "manifest_malformed"
  | "unsupported_schema_version"
  | "manifest_checksum_mismatch"
  | "reference_not_found"
  | "object_missing"
  | "object_size_mismatch"
  | "object_checksum_mismatch"
  | "object_malformed_json"
  | "archive_io_failed";

export class RawArchiveError extends Error {
  constructor(readonly code: RawArchiveErrorCode) {
    super(code);
    this.name = "RawArchiveError";
  }

  toJSON(): { name: string; code: RawArchiveErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export interface CreateRawArchiveOptions {
  root: string;
  runId: string;
  sourceScope: RawArchiveSourceScope;
  createdAt: string;
  retention: RawArchiveRetention;
  permissionVerification: RawArchivePermissionVerification;
  forbiddenSecretValues?: readonly string[];
}

export interface ArchiveRawPayloadInput<
  Kind extends RawArchiveEntityKind = RawArchiveEntityKind,
> {
  entityKind: Kind;
  sourceIdentity: RawArchiveSourceIdentity<Kind>;
  sourceEndpoint: RawArchiveSourceEndpoint;
  classification: RawArchiveClassification;
  fetchedAt: string;
  payload: unknown;
  metadata?: { [key: string]: JsonValue };
}

export interface RawArchiveVerificationSummary {
  runId: string;
  manifestSha256: string;
  entryCount: number;
  objectCount: number;
  permissionVerification: RawArchivePermissionVerification;
}
import { z } from "zod";
