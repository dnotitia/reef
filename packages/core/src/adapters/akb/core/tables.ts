import { z } from "zod";
import {
  ConflictError,
  SchemaLifecycleError,
  SchemaValidationError,
} from "../../../errors";
import {
  REEF_SETTINGS_SCHEMA_VERSION_KEY,
  REEF_SETTINGS_TABLE,
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
import {
  AKB_MANAGED_TABLE_COLUMNS,
  type AkbCreateTableRequest,
  type AkbTableColumn,
  AkbTableColumnTypeSchema,
  REEF_DESIRED_TABLES,
  REEF_SCHEMA_VERSION,
} from "./tableManifest";
import { withSpan } from "./tracing";

export { REEF_DESIRED_TABLES, REEF_SCHEMA_VERSION } from "./tableManifest";

// ─── Tables: HTTP primitives ──────────────────────────────────────────────────
//
// akb accepts the number/json aliases on create, then returns their canonical
// numeric/jsonb forms when listing the table. SQL escaping for the DML endpoint
// lives in `sql.ts`.

const NonEmptyStringSchema = z.string().min(1);

export const AkbTableMutationColumnTypeSchema = z.enum([
  "text",
  "int",
  "float",
  "numeric",
  "number",
  "boolean",
  "uuid",
  "date",
  "timestamp",
  "jsonb",
  "json",
  "text[]",
  "enum",
]);

const AkbAddedColumnSchema = z
  .object({
    name: NonEmptyStringSchema,
    type: AkbTableMutationColumnTypeSchema,
  })
  .passthrough();

const AkbAlteredColumnSchema = z
  .object({ name: NonEmptyStringSchema })
  .passthrough();

const AkbUniqueKeySchema = z
  .object({
    name: NonEmptyStringSchema.optional(),
    columns: z.array(NonEmptyStringSchema).min(1),
  })
  .passthrough();

const AkbIndexColumnSchema = z.union([
  NonEmptyStringSchema,
  z.object({ name: NonEmptyStringSchema }).passthrough(),
]);

const AkbIndexSchema = z
  .object({
    name: NonEmptyStringSchema.optional(),
    columns: z.array(AkbIndexColumnSchema).min(1),
  })
  .passthrough();

export const AkbAlterTableChangesSchema = z
  .object({
    add_columns: z.array(AkbAddedColumnSchema).optional(),
    alter_columns: z.array(AkbAlteredColumnSchema).optional(),
    drop_columns: z.array(NonEmptyStringSchema).optional(),
    rename_columns: z.record(NonEmptyStringSchema).optional(),
    add_unique_keys: z.array(AkbUniqueKeySchema).optional(),
    drop_unique_keys: z.array(NonEmptyStringSchema).optional(),
    add_indexes: z.array(AkbIndexSchema).optional(),
    drop_indexes: z.array(NonEmptyStringSchema).optional(),
  })
  .strict()
  .superRefine((changes, ctx) => {
    for (const oldName of Object.keys(changes.rename_columns ?? {})) {
      if (oldName.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_small,
          minimum: 1,
          inclusive: true,
          type: "string",
          path: ["rename_columns", oldName],
          message: "rename source must not be empty",
        });
      }
    }
  });

const MigrationBaseSchema = z.object({ table: NonEmptyStringSchema });

export const AkbTableMigrationOperationSchema = z.discriminatedUnion("op", [
  MigrationBaseSchema.extend({
    op: z.literal("add_column"),
    column: AkbAddedColumnSchema,
  }).strict(),
  MigrationBaseSchema.extend({
    op: z.literal("alter_column"),
    column: AkbAlteredColumnSchema,
  }).strict(),
  MigrationBaseSchema.extend({
    op: z.literal("drop_column"),
    name: NonEmptyStringSchema,
  }).strict(),
  MigrationBaseSchema.extend({
    op: z.literal("rename_column"),
    from: NonEmptyStringSchema,
    to: NonEmptyStringSchema,
  }).strict(),
  MigrationBaseSchema.extend({
    op: z.literal("add_unique_key"),
    unique_key: AkbUniqueKeySchema,
  }).strict(),
  MigrationBaseSchema.extend({
    op: z.literal("drop_unique_key"),
    name: NonEmptyStringSchema,
  }).strict(),
  MigrationBaseSchema.extend({
    op: z.literal("add_index"),
    index: AkbIndexSchema,
  }).strict(),
  MigrationBaseSchema.extend({
    op: z.literal("drop_index"),
    name: NonEmptyStringSchema,
  }).strict(),
]);

export const AkbTableMigrationOperationsSchema = z
  .array(AkbTableMigrationOperationSchema)
  .min(1);

const AkbTableResponseColumnSchema = z
  .object({
    name: NonEmptyStringSchema,
    type: AkbTableMutationColumnTypeSchema,
  })
  .passthrough();

export const AkbTableResultSchema = z
  .object({
    kind: z.literal("table"),
    uri: NonEmptyStringSchema,
    vault: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    columns: z.array(AkbTableResponseColumnSchema),
    unique_keys: z.array(z.record(z.unknown())),
    indexes: z.array(z.record(z.unknown())),
  })
  .passthrough();

const AkbTableMigrationStepResultSchema = z
  .object({
    index: z.number().int().positive(),
    op: NonEmptyStringSchema,
    table: NonEmptyStringSchema,
    result: AkbTableResultSchema,
  })
  .passthrough();

export const AkbTableMigrationResultSchema = z
  .object({
    kind: z.literal("table_migration"),
    id: z.string().uuid().optional(),
    vault: NonEmptyStringSchema,
    idempotency_key: z.string().uuid(),
    checksum: NonEmptyStringSchema,
    applied: z.boolean(),
    applied_at: NonEmptyStringSchema.optional(),
    operations: z.number().int().positive(),
    results: z.array(AkbTableMigrationStepResultSchema),
  })
  .passthrough();

export type AkbAlterTableChanges = z.infer<typeof AkbAlterTableChangesSchema>;
export type AkbTableMigrationOperation = z.infer<
  typeof AkbTableMigrationOperationSchema
>;
export type AkbTableResult = z.infer<typeof AkbTableResultSchema>;
export type AkbTableMigrationResult = z.infer<
  typeof AkbTableMigrationResultSchema
>;

export interface AlterAkbTableParams {
  adapter: AkbAdapter;
  vault: string;
  table: string;
  changes: AkbAlterTableChanges;
}

export interface ApplyAkbTableMigrationParams {
  adapter: AkbAdapter;
  vault: string;
  idempotencyKey: string;
  operations: AkbTableMigrationOperation[];
}

function schemaValidationError(error: z.ZodError): SchemaValidationError {
  return new SchemaValidationError({
    clientValidated: true,
    issues: error.issues.map(
      (issue) => `${issue.path.join(".") || "input"}: ${issue.message}`,
    ),
  });
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw schemaValidationError(parsed.error);
  return parsed.data;
}

function alterOperationCount(changes: AkbAlterTableChanges): number {
  return (
    (changes.add_columns?.length ?? 0) +
    (changes.alter_columns?.length ?? 0) +
    (changes.drop_columns?.length ?? 0) +
    Object.keys(changes.rename_columns ?? {}).length +
    (changes.add_unique_keys?.length ?? 0) +
    (changes.drop_unique_keys?.length ?? 0) +
    (changes.add_indexes?.length ?? 0) +
    (changes.drop_indexes?.length ?? 0)
  );
}

/** Apply one low-level, transactional table alter through AKB's REST API. */
export async function alterAkbTable(
  params: AlterAkbTableParams,
): Promise<AkbTableResult> {
  const parsed = parseOrThrow(
    z.object({
      vault: NonEmptyStringSchema,
      table: NonEmptyStringSchema,
      changes: AkbAlterTableChangesSchema,
    }),
    params,
  );
  return withSpan(
    "akb.tables.alter",
    {
      vault: parsed.vault,
      table: parsed.table,
      operation_count: alterOperationCount(parsed.changes),
    },
    async () => {
      const payload = await params.adapter.request(
        `/api/v1/tables/${encodeURIComponent(parsed.vault)}/${encodeURIComponent(parsed.table)}`,
        {
          method: "PATCH",
          body: parsed.changes,
          resource: `table ${parsed.table}`,
        },
      );
      return parseOrThrow(AkbTableResultSchema, payload);
    },
  );
}

/** Apply an atomic table migration with a caller-owned idempotency UUID. */
export async function applyAkbTableMigration(
  params: ApplyAkbTableMigrationParams,
): Promise<AkbTableMigrationResult> {
  const parsed = parseOrThrow(
    z.object({
      vault: NonEmptyStringSchema,
      idempotencyKey: z.string().uuid(),
      operations: AkbTableMigrationOperationsSchema,
    }),
    params,
  );
  return withSpan(
    "akb.tables.migrate",
    { vault: parsed.vault, operation_count: parsed.operations.length },
    async () => {
      const payload = await params.adapter.request(
        `/api/v1/tables/${encodeURIComponent(parsed.vault)}/migrations`,
        {
          method: "POST",
          body: parsed.operations,
          rawHeaders: { "Idempotency-Key": parsed.idempotencyKey },
          resource: `table migration in vault ${parsed.vault}`,
        },
      );
      return parseOrThrow(AkbTableMigrationResultSchema, payload);
    },
  );
}

export interface WorkspaceSchemaParams {
  adapter: AkbAdapter;
  vault: string;
}

export type WorkspaceSchemaReconcileParams = WorkspaceSchemaParams &
  (
    | {
        desiredTables?: never;
        schemaVersion?: never;
        allowAdditionalColumns?: never;
      }
    | {
        /** Historical create-time manifests for a catalog reconcile-only phase. */
        desiredTables: readonly AkbCreateTableRequest[];
        /** Version stamped after the selected manifests are durably verified. */
        schemaVersion: number;
        /** Later catalog phases may already have added columns during replay. */
        allowAdditionalColumns: true;
      }
  );

export interface WorkspaceSchemaVerification {
  schemaVersion: number | null;
  manifestVerified: boolean;
}

export function assertNoAkbManagedColumns(table: AkbCreateTableRequest): void {
  const reserved = new Set<string>(AKB_MANAGED_TABLE_COLUMNS);
  const conflicts = table.columns
    .map((column) => column.name)
    .filter((column) => reserved.has(column));
  if (conflicts.length > 0) {
    throw new SchemaValidationError({
      field: `Reef table ${table.name} AKB-managed columns (${conflicts.join(
        ", ",
      )})`,
      issues: [
        `Reef table ${table.name} declares AKB-managed columns: ${conflicts.join(
          ", ",
        )}`,
      ],
    });
  }
}

interface AkbTableSummary {
  name: string;
  columns?: AkbTableColumn[];
}

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
  assertNoAkbManagedColumns(body);
  await adapter.request(`/api/v1/tables/${encodeURIComponent(vault)}`, {
    method: "POST",
    body,
    resource: `table ${body.name}`,
  });
}

/**
 * Drop a single dynamic table from a vault via
 * `DELETE /api/v1/tables/{vault}/{table}` (akb requires admin role — the same
 * floor as deleting the vault). akb has no SQL DDL endpoint, so this REST route
 * is the supported way to drop a table. A missing table surfaces as `NotFoundError`;
 * teardown callers treat that as already-done.
 */
export async function dropAkbTable(
  adapter: AkbAdapter,
  vault: string,
  table: string,
): Promise<void> {
  await adapter.request(
    `/api/v1/tables/${encodeURIComponent(vault)}/${encodeURIComponent(table)}`,
    { method: "DELETE", resource: `table ${table}` },
  );
}

function tableMap(tables: AkbTableSummary[]): Map<string, AkbTableSummary> {
  return new Map(tables.map((table) => [table.name, table]));
}

function tableHasColumnMetadata(table: AkbTableSummary | undefined): boolean {
  return Array.isArray(table?.columns);
}

function canonicalColumnType(type: AkbTableColumn["type"]): string {
  if (type === "number" || type === "numeric") return "numeric";
  if (type === "json" || type === "jsonb") return "jsonb";
  return type;
}

function columnsMatch(
  expected: readonly AkbTableColumn[],
  actual: readonly AkbTableColumn[] | undefined,
  allowAdditionalColumns = false,
): boolean {
  if (!actual) return true;
  if (!allowAdditionalColumns && actual.length !== expected.length)
    return false;
  if (allowAdditionalColumns && actual.length < expected.length) return false;
  const actualByName = new Map(actual.map((col) => [col.name, col]));
  return expected.every((expectedColumn) => {
    const actualColumn = actualByName.get(expectedColumn.name);
    return (
      actualColumn !== undefined &&
      canonicalColumnType(actualColumn.type) ===
        canonicalColumnType(expectedColumn.type) &&
      Boolean(actualColumn.required) === Boolean(expectedColumn.required)
    );
  });
}

function manifestMatchesTable(
  manifest: AkbCreateTableRequest,
  table: AkbTableSummary | undefined,
  allowAdditionalColumns = false,
): boolean {
  return (
    table?.name === manifest.name &&
    tableHasColumnMetadata(table) &&
    columnsMatch(manifest.columns, table.columns, allowAdditionalColumns)
  );
}

function assertManifestMatches(
  manifest: AkbCreateTableRequest,
  table: AkbTableSummary | undefined,
  allowAdditionalColumns = false,
): void {
  if (!table) {
    throw new SchemaValidationError({
      issues: [`Missing Reef table: ${manifest.name}`],
    });
  }
  if (!columnsMatch(manifest.columns, table.columns, allowAdditionalColumns)) {
    throw new SchemaValidationError({
      issues: [`Reef table schema mismatch: ${manifest.name}`],
    });
  }
}

function canVerifySchema(
  tables: AkbTableSummary[],
  desiredTables: readonly AkbCreateTableRequest[],
): boolean {
  const byName = tableMap(tables);
  return desiredTables.every((manifest) =>
    tableHasColumnMetadata(byName.get(manifest.name)),
  );
}

function assertDesiredTablesMatch(
  tables: AkbTableSummary[],
  desiredTables: readonly AkbCreateTableRequest[],
  allowAdditionalColumns = false,
): void {
  const byName = tableMap(tables);
  for (const manifest of desiredTables) {
    assertManifestMatches(
      manifest,
      byName.get(manifest.name),
      allowAdditionalColumns,
    );
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
  schemaVersion: number,
): Promise<void> {
  const stamp = {
    version: schemaVersion,
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
  manifest: AkbCreateTableRequest,
  allowAdditionalColumns: boolean,
): Promise<void> {
  try {
    await createAkbTable(adapter, vault, manifest);
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    const refreshed = tableMap(await listAkbTables(adapter, vault));
    if (
      !manifestMatchesTable(
        manifest,
        refreshed.get(manifest.name),
        allowAdditionalColumns,
      )
    ) {
      throw err;
    }
  }
}

/**
 * Reconcile the vault's Reef tables against the current desired manifest or an
 * immutable historical manifest snapshot selected by the startup catalog.
 *
 * Missing tables are created. Existing tables with column metadata are verified
 * before the `schema_version` stamp is written; a mismatch fails hard instead of
 * pretending runtime ALTER/DROP will repair it.
 */
export async function reconcileWorkspaceSchema(
  params: WorkspaceSchemaReconcileParams,
): Promise<void> {
  const { adapter, vault } = params;
  const desiredTables = params.desiredTables ?? REEF_DESIRED_TABLES;
  const desiredSchemaVersion = params.schemaVersion ?? REEF_SCHEMA_VERSION;
  const allowAdditionalColumns = params.allowAdditionalColumns ?? false;
  return withSpan("akb.tables.reconcile", { vault }, async (span) => {
    for (const manifest of desiredTables) {
      assertNoAkbManagedColumns(manifest);
    }
    let tables = await listAkbTables(adapter, vault);
    const initial = tableMap(tables);
    span.setAttribute("existing_table_count", initial.size);

    const supportsSchemaVerification = canVerifySchema(tables, desiredTables);
    if (supportsSchemaVerification) {
      assertDesiredTablesMatch(tables, desiredTables, allowAdditionalColumns);
    }
    const storedVersion = supportsSchemaVerification
      ? await readStoredSchemaVersion(
          adapter,
          vault,
          initial.has(REEF_SETTINGS_TABLE),
        )
      : 0;
    const missing = desiredTables.filter(
      (manifest) => !initial.has(manifest.name),
    );
    if (!supportsSchemaVerification && missing.length === 0) {
      span.setAttribute("schema_version", 0);
      span.setAttribute("desired_schema_version", desiredSchemaVersion);
      span.setAttribute("created_table_count", 0);
      return;
    }
    const schemaUpToDate = storedVersion >= desiredSchemaVersion;
    span.setAttribute("schema_version", storedVersion);
    span.setAttribute("desired_schema_version", desiredSchemaVersion);

    if (schemaUpToDate && missing.length === 0) {
      span.setAttribute("created_table_count", 0);
      return;
    }

    await Promise.all(
      missing.map((manifest) =>
        createMissingTable(adapter, vault, manifest, allowAdditionalColumns),
      ),
    );

    tables = await listAkbTables(adapter, vault);
    if (canVerifySchema(tables, desiredTables)) {
      assertDesiredTablesMatch(tables, desiredTables, allowAdditionalColumns);
      await stampSchemaVersion(
        adapter,
        vault,
        Math.max(storedVersion, desiredSchemaVersion),
      );
    }

    span.setAttribute("created_table_count", missing.length);
  });
}

/**
 * Read and validate a workspace schema without creating, altering, or stamping.
 *
 * AKB responses without column metadata cannot prove compatibility and fail
 * closed. Current responses are checked against the complete manifest and
 * exact release schema version.
 */
export async function verifyWorkspaceSchema(
  params: WorkspaceSchemaParams,
): Promise<WorkspaceSchemaVerification> {
  const { adapter, vault } = params;
  return withSpan("akb.tables.verify", { vault }, async (span) => {
    const tables = await listAkbTables(adapter, vault);
    const byName = tableMap(tables);
    const missing = REEF_DESIRED_TABLES.filter(
      (manifest) => !byName.has(manifest.name),
    );
    if (missing.length > 0) {
      throw new SchemaLifecycleError({ reason: "schema_not_ready", vault });
    }

    if (!canVerifySchema(tables, REEF_DESIRED_TABLES)) {
      span.setAttribute("manifest_verified", false);
      throw new SchemaLifecycleError({ reason: "schema_mismatch", vault });
    }

    try {
      assertDesiredTablesMatch(tables, REEF_DESIRED_TABLES);
    } catch (error) {
      if (!(error instanceof SchemaValidationError)) throw error;
      throw new SchemaLifecycleError({ reason: "schema_mismatch", vault });
    }
    const schemaVersion = await readStoredSchemaVersion(adapter, vault, true);
    if (schemaVersion !== REEF_SCHEMA_VERSION) {
      throw new SchemaLifecycleError({ reason: "schema_mismatch", vault });
    }
    span.setAttribute("manifest_verified", true);
    span.setAttribute("schema_version", schemaVersion);
    return { schemaVersion, manifestVerified: true };
  });
}
