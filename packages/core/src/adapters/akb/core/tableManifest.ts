import { z } from "zod";
import {
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ACTIVITY_TABLE,
  REEF_ATTACHMENTS_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
} from "./constants";

export const AkbTableColumnTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "json",
]);

export interface AkbTableColumn {
  name: string;
  type: z.infer<typeof AkbTableColumnTypeSchema>;
  required?: boolean;
}

export interface AkbCreateTableRequest {
  name: string;
  description?: string;
  columns: AkbTableColumn[];
  collection?: string | null;
}

export interface ReefTableManifest extends AkbCreateTableRequest {
  name:
    | typeof REEF_SETTINGS_TABLE
    | typeof MONITORED_REPOS_TABLE
    | typeof REEF_ISSUES_TABLE
    | typeof REEF_SPRINTS_TABLE
    | typeof REEF_MILESTONES_TABLE
    | typeof REEF_RELEASES_TABLE
    | typeof REEF_TEMPLATES_TABLE
    | typeof REEF_ACTIVITY_SUGGESTIONS_TABLE
    | typeof REEF_COMMENTS_TABLE
    | typeof REEF_ATTACHMENTS_TABLE
    | typeof REEF_ACTIVITY_TABLE;
  columns: AkbTableColumn[];
}

export const REEF_SCHEMA_VERSION = 1;

/** Columns injected and owned by AKB for every dynamic table. */
export const AKB_MANAGED_TABLE_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "created_by",
] as const;

/**
 * Declarative desired schema for every AKB dynamic table Reef owns. Keep this
 * additive/create-time complete: Reef's runtime HTTP path can create tables but
 * does not rely on ALTER/DROP to repair an already-created table.
 */
export const REEF_DESIRED_TABLES: readonly ReefTableManifest[] = [
  {
    name: REEF_SETTINGS_TABLE,
    description: "reef key-value team-shared workspace settings",
    // akb auto-injects id/created_at/updated_at/created_by on every dynamic
    // table; declaring our own `updated_at` here would collide with the
    // reserved name and fail table creation.
    columns: [
      { name: "key", type: "text", required: true },
      { name: "value", type: "json", required: true },
    ],
  },
  {
    name: MONITORED_REPOS_TABLE,
    description: "GitHub repos monitored by this reef workspace",
    columns: [
      { name: "github_id", type: "number", required: true },
      { name: "owner", type: "text", required: true },
      { name: "name", type: "text", required: true },
      { name: "description", type: "text" },
    ],
  },
  {
    name: REEF_ISSUES_TABLE,
    description: "Queryable read projection of reef issue documents",
    // akb auto-injects id/created_at/updated_at/created_by; we read the auto
    // created_at/updated_at as the issue's timestamps (row INSERT happens at
    // issue creation) and should not declare them here. `meta` json carries the
    // reef "semantic actor" fields (author/last_editor) and `source` —
    // distinct from akb's auth-principal created_by — plus future extension
    // fields, sidestepping the no-ALTER-TABLE-over-HTTP limitation.
    columns: [
      { name: "document_uri", type: "text", required: true },
      { name: "reef_id", type: "text", required: true },
      { name: "title", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "issue_type", type: "text", required: true },
      { name: "priority", type: "text" },
      { name: "assigned_to", type: "text" },
      { name: "requester", type: "text" },
      { name: "reporter", type: "text" },
      { name: "start_date", type: "text" },
      { name: "due_date", type: "text" },
      { name: "milestone_id", type: "text" },
      { name: "sprint_id", type: "text" },
      { name: "release_id", type: "text" },
      { name: "estimate_points", type: "number" },
      { name: "severity", type: "text" },
      { name: "rank", type: "number" },
      { name: "closed_at", type: "text" },
      { name: "closed_reason", type: "text" },
      { name: "parent_id", type: "text" },
      { name: "labels", type: "json" },
      { name: "depends_on", type: "json" },
      { name: "related_to", type: "json" },
      { name: "blocks", type: "json" },
      { name: "archived_at", type: "text" },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_SPRINTS_TABLE,
    description: "Managed sprint metadata for reef issue planning",
    // akb auto-injects the uuid `id` primary key (and created_at/
    // created_by/updated_at); declaring our own `id` is rejected as a reserved
    // column. The row is addressed by that akb uuid.
    columns: [
      { name: "name", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "start_date", type: "text" },
      { name: "end_date", type: "text" },
      { name: "goal", type: "text" },
      { name: "capacity_points", type: "number" },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_MILESTONES_TABLE,
    description: "Managed milestone metadata for reef issue planning",
    columns: [
      { name: "name", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "target_date", type: "text" },
      { name: "description", type: "text" },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_RELEASES_TABLE,
    description: "Managed release metadata for reef issue planning",
    columns: [
      { name: "name", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "target_date", type: "text" },
      { name: "released_at", type: "text" },
      { name: "notes", type: "text" },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_TEMPLATES_TABLE,
    description: "Issue templates for this reef workspace",
    // akb auto-injects id/created_at/updated_at/created_by. `name` is the
    // logical key (the filename-stem id surfaced in the UI). `body` is a plain
    // text column — the template is self-contained, no backing document. `meta`
    // json holds future non-filtered extension fields, sidestepping the
    // no-ALTER-TABLE-over-HTTP limitation.
    columns: [
      { name: "name", type: "text", required: true },
      { name: "label", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "title_prefix", type: "text" },
      { name: "priority", type: "text" },
      { name: "default_labels", type: "json" },
      { name: "body", type: "text" },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_ACTIVITY_SUGGESTIONS_TABLE,
    description:
      "Queryable read projection of reef AI activity inbox documents",
    columns: [
      { name: "document_uri", type: "text", required: true },
      { name: "suggestion_id", type: "text", required: true },
      { name: "kind", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "fingerprint", type: "text", required: true },
      { name: "repo", type: "text", required: true },
      { name: "issue_id", type: "text" },
      { name: "title", type: "text" },
      { name: "summary", type: "text" },
      { name: "source_type", type: "text" },
      { name: "source_ref", type: "text" },
      { name: "actor", type: "text" },
      { name: "detected_at", type: "text", required: true },
      { name: "reviewed_at", type: "text" },
      { name: "reviewed_by", type: "text" },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_COMMENTS_TABLE,
    description: "Flat issue comments for reef issue collaboration",
    columns: [
      { name: "reef_id", type: "text", required: true },
      { name: "body", type: "text", required: true },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_ATTACHMENTS_TABLE,
    description: "Issue-scoped metadata for AKB file attachments",
    columns: [
      { name: "reef_id", type: "text", required: true },
      { name: "file_uri", type: "text", required: true },
      { name: "filename", type: "text", required: true },
      { name: "mime_type", type: "text", required: true },
      { name: "size_bytes", type: "number", required: true },
      { name: "author", type: "text", required: true },
      { name: "source", type: "text", required: true },
      { name: "inline", type: "boolean" },
      { name: "original_jira_attachment_id", type: "text" },
      { name: "meta", type: "json" },
    ],
  },
  {
    name: REEF_ACTIVITY_TABLE,
    description: "Immutable reef issue activity events",
    columns: [
      { name: "reef_id", type: "text", required: true },
      { name: "event_type", type: "text", required: true },
      { name: "event_key", type: "text", required: true },
      { name: "payload", type: "json" },
      { name: "meta", type: "json" },
    ],
  },
];
