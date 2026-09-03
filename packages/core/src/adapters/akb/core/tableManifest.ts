import { z } from "zod";
import {
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_TABLE,
  REEF_ATTACHMENTS_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_NOTIFICATIONS_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_SUBSCRIPTIONS_TABLE,
  REEF_TEMPLATES_TABLE,
} from "./constants";

export const AkbTableColumnTypeSchema = z.enum([
  "text",
  "int",
  "float",
  "numeric",
  "boolean",
  "uuid",
  "date",
  "timestamp",
  "jsonb",
  "text[]",
  "enum",
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
  unique_keys?: AkbTableUniqueKey[];
  indexes?: AkbTableIndex[];
}

export interface AkbTableUniqueKey {
  name?: string;
  columns: string[];
}

export interface AkbTableIndexColumn {
  name: string;
  order?: "asc" | "desc";
}

export interface AkbTableIndex {
  name?: string;
  columns: Array<string | AkbTableIndexColumn>;
}

export interface ReefCanonicalTableProjection {
  name: string;
  columns: Array<{
    name: string;
    type: AkbTableColumn["type"];
    required?: true;
  }>;
  unique_keys: Array<{ columns: string[] }>;
  indexes: Array<{
    columns: Array<{ name: string; order: "asc" | "desc" }>;
  }>;
}

export interface ReefTableProjectionInput {
  name: string;
  columns: readonly AkbTableColumn[];
  unique_keys?: readonly AkbTableUniqueKey[];
  indexes?: readonly AkbTableIndex[];
}

function assertProjectionKeys(
  value: object,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(`${label} contains an unsupported field`);
  }
}

function compareProjectionStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Project one table declaration into AKB's logical canonical table shape.
 * Physical constraint/index names are intentionally excluded. All Reef table
 * creation, fingerprint, Blueprint, and release paths consume this projection.
 */
export function canonicalReefTableProjection(
  table: ReefTableProjectionInput,
): ReefCanonicalTableProjection {
  const columns = table.columns
    .map((column) => {
      assertProjectionKeys(
        column,
        ["name", "type", "required"],
        "Table column",
      );
      const projected: ReefCanonicalTableProjection["columns"][number] = {
        name: column.name,
        type: column.type,
      };
      if (column.required === true) projected.required = true;
      return projected;
    })
    .sort((left, right) => compareProjectionStrings(left.name, right.name));
  const columnNames = new Set(columns.map((column) => column.name));
  if (columnNames.size !== columns.length) {
    throw new TypeError("Table columns must have unique names");
  }

  const uniqueKeys = (table.unique_keys ?? [])
    .map((uniqueKey) => {
      assertProjectionKeys(uniqueKey, ["name", "columns"], "Table unique key");
      const columns = [...uniqueKey.columns];
      if (
        columns.length === 0 ||
        new Set(columns).size !== columns.length ||
        columns.some((column) => !columnNames.has(column))
      ) {
        throw new TypeError(
          "Table unique keys must reference distinct declared columns",
        );
      }
      return { columns };
    })
    .sort((left, right) =>
      compareProjectionStrings(
        JSON.stringify(left.columns),
        JSON.stringify(right.columns),
      ),
    );

  const indexes = (table.indexes ?? [])
    .map((index) => {
      assertProjectionKeys(index, ["name", "columns"], "Table index");
      const columns = index.columns.map((column) => {
        if (typeof column === "string") {
          return { name: column, order: "asc" as const };
        }
        assertProjectionKeys(column, ["name", "order"], "Table index column");
        return { name: column.name, order: column.order ?? "asc" };
      });
      if (
        columns.length === 0 ||
        new Set(columns.map((column) => column.name)).size !== columns.length ||
        columns.some((column) => !columnNames.has(column.name))
      ) {
        throw new TypeError(
          "Table indexes must reference distinct declared columns",
        );
      }
      return { columns };
    })
    .sort((left, right) =>
      compareProjectionStrings(
        JSON.stringify(left.columns),
        JSON.stringify(right.columns),
      ),
    );

  return { name: table.name, columns, unique_keys: uniqueKeys, indexes };
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
    | typeof REEF_COMMENTS_TABLE
    | typeof REEF_ATTACHMENTS_TABLE
    | typeof REEF_ACTIVITY_TABLE
    | typeof REEF_NOTIFICATIONS_TABLE
    | typeof REEF_SUBSCRIPTIONS_TABLE;
  columns: AkbTableColumn[];
}

export const REEF_SCHEMA_VERSION = 3;

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
      { name: "value", type: "jsonb", required: true },
    ],
  },
  {
    name: MONITORED_REPOS_TABLE,
    description: "GitHub repos monitored by this reef workspace",
    columns: [
      { name: "github_id", type: "numeric", required: true },
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
    // fields as an extension envelope pending an explicit operator migration,
    // including environments where migration execution is unavailable.
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
      { name: "estimate_points", type: "numeric" },
      { name: "severity", type: "text" },
      { name: "rank", type: "numeric" },
      { name: "closed_at", type: "text" },
      { name: "closed_reason", type: "text" },
      { name: "parent_id", type: "text" },
      { name: "labels", type: "jsonb" },
      { name: "depends_on", type: "jsonb" },
      { name: "related_to", type: "jsonb" },
      { name: "blocks", type: "jsonb" },
      { name: "archived_at", type: "text" },
      { name: "meta", type: "jsonb" },
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
      { name: "capacity_points", type: "numeric" },
      { name: "meta", type: "jsonb" },
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
      { name: "meta", type: "jsonb" },
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
      { name: "meta", type: "jsonb" },
    ],
  },
  {
    name: REEF_TEMPLATES_TABLE,
    description: "Issue templates for this reef workspace",
    // akb auto-injects id/created_at/updated_at/created_by. `name` is the
    // logical key (the filename-stem id surfaced in the UI). `body` is a plain
    // text column — the template is self-contained, no backing document. `meta`
    // json holds future non-filtered extension fields as an extension envelope
    // pending an explicit operator migration, including environments where
    // migration execution is unavailable.
    columns: [
      { name: "name", type: "text", required: true },
      { name: "label", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "title_prefix", type: "text" },
      { name: "priority", type: "text" },
      { name: "default_labels", type: "jsonb" },
      { name: "body", type: "text" },
      { name: "meta", type: "jsonb" },
    ],
  },
  {
    name: REEF_COMMENTS_TABLE,
    description: "Flat issue comments for reef issue collaboration",
    columns: [
      { name: "reef_id", type: "text", required: true },
      { name: "body", type: "text", required: true },
      { name: "meta", type: "jsonb" },
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
      { name: "size_bytes", type: "numeric", required: true },
      { name: "author", type: "text", required: true },
      { name: "source", type: "text", required: true },
      { name: "inline", type: "boolean" },
      { name: "original_jira_attachment_id", type: "text" },
      { name: "meta", type: "jsonb" },
    ],
  },
  {
    name: REEF_ACTIVITY_TABLE,
    description: "Immutable reef issue activity events",
    columns: [
      { name: "reef_id", type: "text", required: true },
      { name: "event_type", type: "text", required: true },
      { name: "event_key", type: "text", required: true },
      { name: "payload", type: "jsonb" },
      { name: "meta", type: "jsonb" },
    ],
  },
  {
    name: REEF_NOTIFICATIONS_TABLE,
    description: "Recipient-scoped reef notifications",
    columns: [
      { name: "notification_key", type: "text", required: true },
      { name: "recipient", type: "text", required: true },
      { name: "reef_id", type: "text", required: true },
      { name: "source_type", type: "text", required: true },
      { name: "source_ref", type: "text", required: true },
      { name: "event_type", type: "text", required: true },
      { name: "actor", type: "text", required: true },
      { name: "occurred_at", type: "text", required: true },
      { name: "state", type: "text", required: true },
      { name: "read_at", type: "text" },
      { name: "archived_at", type: "text" },
      { name: "payload", type: "jsonb" },
      { name: "meta", type: "jsonb" },
    ],
    unique_keys: [
      { columns: ["notification_key"] },
      { columns: ["recipient", "source_type", "source_ref"] },
    ],
    indexes: [
      {
        columns: ["recipient", "state", { name: "occurred_at", order: "desc" }],
      },
    ],
  },
  {
    name: REEF_SUBSCRIPTIONS_TABLE,
    description: "Source-aware reef issue subscriptions",
    columns: [
      { name: "subscription_key", type: "text", required: true },
      { name: "reef_id", type: "text", required: true },
      { name: "subscriber", type: "text", required: true },
      { name: "source", type: "text", required: true },
      { name: "status", type: "text", required: true },
      { name: "subscribed_at", type: "text", required: true },
      { name: "meta", type: "jsonb" },
    ],
    unique_keys: [
      { columns: ["subscription_key"] },
      { columns: ["reef_id", "subscriber", "source"] },
    ],
    indexes: [{ columns: ["reef_id", "status", "subscriber"] }],
  },
];
