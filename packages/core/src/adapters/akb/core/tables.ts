import { z } from "zod";
import { ConflictError, SchemaValidationError } from "../../../errors";
import {
  MONITORED_REPOS_TABLE,
  REEF_ACTIVITY_SUGGESTIONS_TABLE,
  REEF_ACTIVITY_TABLE,
  REEF_COMMENTS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_MILESTONES_TABLE,
  REEF_RELEASES_TABLE,
  REEF_SETTINGS_SCHEMA_VERSION_KEY,
  REEF_SETTINGS_TABLE,
  REEF_SPRINTS_TABLE,
  REEF_TEMPLATES_TABLE,
} from "./constants";
import type { AkbAdapter } from "./http";
import {
  decodeSettingsValue,
  isMissingTableError,
  quoteJson,
  quoteText,
  runSql,
  tableRef,
} from "./sql";
import { withSpan } from "./tracing";

// ─── Tables: HTTP primitives ──────────────────────────────────────────────────
//
// akb exposes typed columns (text|number|boolean|date|json + required) via
// `POST /api/v1/tables/{vault}`. SQL escaping for the DML endpoint lives in
// `sql.ts`.

const AkbTableColumnTypeSchema = z.enum([
  "text",
  "number",
  "boolean",
  "date",
  "json",
]);

interface AkbTableColumn {
  name: string;
  type: z.infer<typeof AkbTableColumnTypeSchema>;
  required?: boolean;
}

interface AkbCreateTableRequest {
  name: string;
  description?: string;
  columns: AkbTableColumn[];
  collection?: string | null;
}

export interface EnsureReefTablesParams {
  adapter: AkbAdapter;
  vault: string;
}

interface AkbTableSummary {
  name: string;
  columns?: AkbTableColumn[];
}

interface ReefTableManifest extends AkbCreateTableRequest {
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
    | typeof REEF_ACTIVITY_TABLE;
  columns: AkbTableColumn[];
}

export const REEF_SCHEMA_VERSION = 1;

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

async function listAkbTables(
  adapter: AkbAdapter,
  vault: string,
): Promise<AkbTableSummary[]> {
  const payload = await adapter.request(
    `/api/v1/tables/${encodeURIComponent(vault)}`,
    { resource: `tables in vault ${vault}` },
  );
  // Defensive parser — akb returns `{ kind: "table", vault, items: [{name}, ...] }`
  // today, but we also accept `{ tables: [...] }` and a bare array so we don't
  // break if the wire shape evolves.
  const items = (() => {
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      if (Array.isArray(obj.items)) return obj.items;
      if (Array.isArray(obj.tables)) return obj.tables;
    }
    if (Array.isArray(payload)) return payload;
    return [];
  })();
  return items.flatMap((item) => {
    if (!item || typeof item !== "object" || !("name" in item)) return [];
    const obj = item as { name: unknown; columns?: unknown };
    const table: AkbTableSummary = { name: String(obj.name) };
    if (Array.isArray(obj.columns)) {
      table.columns = obj.columns.flatMap((col) => {
        const parsed = z
          .object({
            name: z.string(),
            type: AkbTableColumnTypeSchema,
            required: z.boolean().optional(),
          })
          .safeParse(col);
        return parsed.success ? [parsed.data] : [];
      });
    }
    return [table];
  });
}

async function createAkbTable(
  adapter: AkbAdapter,
  vault: string,
  body: AkbCreateTableRequest,
): Promise<void> {
  await adapter.request(`/api/v1/tables/${encodeURIComponent(vault)}`, {
    method: "POST",
    body,
    resource: `table ${body.name}`,
  });
}

function tableMap(tables: AkbTableSummary[]): Map<string, AkbTableSummary> {
  return new Map(tables.map((table) => [table.name, table]));
}

function tableHasColumnMetadata(table: AkbTableSummary | undefined): boolean {
  return Array.isArray(table?.columns);
}

function columnsMatch(
  expected: readonly AkbTableColumn[],
  actual: readonly AkbTableColumn[] | undefined,
): boolean {
  if (!actual) return true;
  if (actual.length !== expected.length) return false;
  const actualByName = new Map(actual.map((col) => [col.name, col]));
  return expected.every((expectedColumn) => {
    const actualColumn = actualByName.get(expectedColumn.name);
    return (
      actualColumn?.type === expectedColumn.type &&
      Boolean(actualColumn.required) === Boolean(expectedColumn.required)
    );
  });
}

function manifestMatchesTable(
  manifest: ReefTableManifest,
  table: AkbTableSummary | undefined,
): boolean {
  return (
    table?.name === manifest.name &&
    tableHasColumnMetadata(table) &&
    columnsMatch(manifest.columns, table.columns)
  );
}

function assertManifestMatches(
  manifest: ReefTableManifest,
  table: AkbTableSummary | undefined,
): void {
  if (!table) {
    throw new SchemaValidationError({
      issues: [`Missing Reef table: ${manifest.name}`],
    });
  }
  if (!columnsMatch(manifest.columns, table.columns)) {
    throw new SchemaValidationError({
      issues: [`Reef table schema mismatch: ${manifest.name}`],
    });
  }
}

function canVerifySchema(tables: AkbTableSummary[]): boolean {
  const byName = tableMap(tables);
  return REEF_DESIRED_TABLES.every((manifest) =>
    tableHasColumnMetadata(byName.get(manifest.name)),
  );
}

function assertDesiredTablesMatch(tables: AkbTableSummary[]): void {
  const byName = tableMap(tables);
  for (const manifest of REEF_DESIRED_TABLES) {
    assertManifestMatches(manifest, byName.get(manifest.name));
  }
}

async function readStoredSchemaVersion(
  adapter: AkbAdapter,
  vault: string,
  hasSettingsTable: boolean,
): Promise<number> {
  if (!hasSettingsTable) return 0;
  try {
    const response = await runSql(
      adapter,
      vault,
      `SELECT value FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
        REEF_SETTINGS_SCHEMA_VERSION_KEY,
        "settings key",
      )} LIMIT 1`,
    );
    const rows = response.kind === "table_query" ? response.items : [];
    const raw = rows[0]?.value;
    const decoded = decodeSettingsValue(raw);
    if (
      decoded &&
      typeof decoded === "object" &&
      "version" in decoded &&
      Number.isInteger((decoded as { version?: unknown }).version)
    ) {
      return Number((decoded as { version: number }).version);
    }
  } catch (err) {
    if (isMissingTableError(err)) return 0;
    throw err;
  }
  return 0;
}

async function stampSchemaVersion(
  adapter: AkbAdapter,
  vault: string,
): Promise<void> {
  const stamp = {
    version: REEF_SCHEMA_VERSION,
    applied_at: new Date().toISOString(),
  };
  await runSql(
    adapter,
    vault,
    `DELETE FROM ${tableRef(REEF_SETTINGS_TABLE)} WHERE key = ${quoteText(
      REEF_SETTINGS_SCHEMA_VERSION_KEY,
      "settings key",
    )}`,
  );
  await runSql(
    adapter,
    vault,
    `INSERT INTO ${tableRef(REEF_SETTINGS_TABLE)} (key, value) VALUES (${quoteText(
      REEF_SETTINGS_SCHEMA_VERSION_KEY,
      "settings key",
    )}, ${quoteJson(stamp)})`,
  );
}

async function createMissingTable(
  adapter: AkbAdapter,
  vault: string,
  manifest: ReefTableManifest,
): Promise<void> {
  try {
    await createAkbTable(adapter, vault, manifest);
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    const refreshed = tableMap(await listAkbTables(adapter, vault));
    if (!manifestMatchesTable(manifest, refreshed.get(manifest.name))) {
      throw err;
    }
  }
}

/**
 * Reconcile the vault's Reef tables against `REEF_DESIRED_TABLES`.
 *
 * Missing tables are created. Existing tables with column metadata are verified
 * before the `schema_version` stamp is written; a mismatch fails hard instead of
 * pretending runtime ALTER/DROP will repair it.
 */
export async function ensureReefTables(
  params: EnsureReefTablesParams,
): Promise<void> {
  const { adapter, vault } = params;
  return withSpan("akb.tables.ensure", { vault }, async (span) => {
    let tables = await listAkbTables(adapter, vault);
    const initial = tableMap(tables);
    span.setAttribute("existing_table_count", initial.size);

    const supportsSchemaVerification = canVerifySchema(tables);
    if (supportsSchemaVerification) {
      assertDesiredTablesMatch(tables);
    }
    const storedVersion = supportsSchemaVerification
      ? await readStoredSchemaVersion(
          adapter,
          vault,
          initial.has(REEF_SETTINGS_TABLE),
        )
      : 0;
    const missing = REEF_DESIRED_TABLES.filter(
      (manifest) => !initial.has(manifest.name),
    );
    if (!supportsSchemaVerification && missing.length === 0) {
      span.setAttribute("schema_version", 0);
      span.setAttribute("desired_schema_version", REEF_SCHEMA_VERSION);
      span.setAttribute("created_table_count", 0);
      return;
    }
    const schemaUpToDate = storedVersion >= REEF_SCHEMA_VERSION;
    span.setAttribute("schema_version", storedVersion);
    span.setAttribute("desired_schema_version", REEF_SCHEMA_VERSION);

    if (schemaUpToDate && missing.length === 0) {
      span.setAttribute("created_table_count", 0);
      return;
    }

    await Promise.all(
      missing.map((manifest) => createMissingTable(adapter, vault, manifest)),
    );

    tables = await listAkbTables(adapter, vault);
    if (canVerifySchema(tables)) {
      assertDesiredTablesMatch(tables);
      await stampSchemaVersion(adapter, vault);
    }

    span.setAttribute("created_table_count", missing.length);
  });
}
