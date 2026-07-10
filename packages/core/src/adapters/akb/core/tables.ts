import { z } from "zod";
import { ConflictError, SchemaValidationError } from "../../../errors";
import {
  REEF_AGENT_RUNS_TABLE,
  REEF_SETTINGS_SCHEMA_VERSION_KEY,
  REEF_SETTINGS_TABLE,
  REEF_WORK_EVENTS_TABLE,
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
  type AkbCreateTableRequest,
  type AkbTableColumn,
  AkbTableColumnTypeSchema,
  REEF_DESIRED_TABLES,
  REEF_SCHEMA_VERSION,
  type ReefTableManifest,
} from "./tableManifest";
import { withSpan } from "./tracing";

export { REEF_DESIRED_TABLES, REEF_SCHEMA_VERSION } from "./tableManifest";

// ─── Tables: HTTP primitives ──────────────────────────────────────────────────
//
// akb exposes typed columns (text|number|boolean|date|json + required) via
// `POST /api/v1/tables/{vault}`. SQL escaping for the DML endpoint lives in
// `sql.ts`.

export interface EnsureReefTablesParams {
  adapter: AkbAdapter;
  vault: string;
  requireSchemaVerification?: boolean;
  requiredTables?: readonly ReefTableManifest["name"][];
}

interface AkbTableSummary {
  name: string;
  columns?: AkbTableColumn[];
  unique_keys?: Array<{ name?: string; columns: string[] }>;
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
    const obj = item as {
      name: unknown;
      columns?: unknown;
      unique_keys?: unknown;
    };
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
    if (Array.isArray(obj.unique_keys)) {
      table.unique_keys = obj.unique_keys.flatMap((key) => {
        const parsed = z
          .object({
            name: z.string().optional(),
            columns: z.array(z.string().min(1)).min(1),
          })
          .safeParse(key);
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

function uniqueKeysMatch(
  expected: readonly { columns: string[] }[] | undefined,
  actual: readonly { columns: string[] }[] | undefined,
): boolean {
  const expectedKeys = expected ?? [];
  if (!actual) return expectedKeys.length === 0;
  if (actual.length !== expectedKeys.length) return false;
  const canonical = (columns: readonly string[]) => columns.join("\u0000");
  const actualKeys = new Set(actual.map((key) => canonical(key.columns)));
  return expectedKeys.every((key) => actualKeys.has(canonical(key.columns)));
}

function manifestMatchesTable(
  manifest: ReefTableManifest,
  table: AkbTableSummary | undefined,
): boolean {
  return (
    table?.name === manifest.name &&
    tableHasColumnMetadata(table) &&
    columnsMatch(manifest.columns, table.columns) &&
    uniqueKeysMatch(manifest.unique_keys, table.unique_keys)
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
  if (!uniqueKeysMatch(manifest.unique_keys, table.unique_keys)) {
    throw new SchemaValidationError({
      issues: [`Reef table unique-key mismatch: ${manifest.name}`],
    });
  }
}

function canVerifySchema(
  tables: AkbTableSummary[],
  manifests: readonly ReefTableManifest[] = REEF_DESIRED_TABLES,
): boolean {
  const byName = tableMap(tables);
  return manifests.every((manifest) =>
    tableHasColumnMetadata(byName.get(manifest.name)),
  );
}

function assertDesiredTablesMatch(
  tables: AkbTableSummary[],
  manifests: readonly ReefTableManifest[] = REEF_DESIRED_TABLES,
): void {
  const byName = tableMap(tables);
  for (const manifest of manifests) {
    assertManifestMatches(manifest, byName.get(manifest.name));
  }
}

function manifestsForStoredVersion(
  storedVersion: number,
): readonly ReefTableManifest[] {
  if (storedVersion !== 3) return REEF_DESIRED_TABLES;
  return REEF_DESIRED_TABLES.map((manifest) => {
    if (manifest.name === REEF_AGENT_RUNS_TABLE) {
      return {
        ...manifest,
        columns: manifest.columns.filter(
          (column) => column.name !== "active_reef_id",
        ),
        unique_keys: undefined,
      };
    }
    if (manifest.name === REEF_WORK_EVENTS_TABLE) {
      return { ...manifest, unique_keys: undefined };
    }
    return manifest;
  });
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
  const {
    adapter,
    vault,
    requireSchemaVerification = false,
    requiredTables,
  } = params;
  return withSpan("akb.tables.ensure", { vault }, async (span) => {
    let tables = await listAkbTables(adapter, vault);
    const initial = tableMap(tables);
    span.setAttribute("existing_table_count", initial.size);

    const requiredNames = new Set(requiredTables ?? []);
    const canInspectDesiredSchema = canVerifySchema(tables);
    const storedVersion =
      !requireSchemaVerification && canInspectDesiredSchema
        ? await readStoredSchemaVersion(
            adapter,
            vault,
            initial.has(REEF_SETTINGS_TABLE),
          )
        : 0;
    const compatibleManifests = requireSchemaVerification
      ? REEF_DESIRED_TABLES
      : manifestsForStoredVersion(storedVersion);
    const verificationManifests =
      requireSchemaVerification && requiredNames.size > 0
        ? compatibleManifests.filter((manifest) =>
            requiredNames.has(manifest.name),
          )
        : compatibleManifests;
    const supportsSchemaVerification = canVerifySchema(
      tables,
      verificationManifests,
    );
    if (requireSchemaVerification && !supportsSchemaVerification) {
      throw new SchemaValidationError({
        issues: ["Reef table schema metadata is unavailable"],
      });
    }
    if (supportsSchemaVerification) {
      assertDesiredTablesMatch(tables, verificationManifests);
    }
    const verifiedStoredVersion =
      requireSchemaVerification && supportsSchemaVerification
        ? await readStoredSchemaVersion(
            adapter,
            vault,
            initial.has(REEF_SETTINGS_TABLE),
          )
        : storedVersion;
    const missing = REEF_DESIRED_TABLES.filter(
      (manifest) => !initial.has(manifest.name),
    );
    if (!supportsSchemaVerification && missing.length === 0) {
      span.setAttribute("schema_version", 0);
      span.setAttribute("desired_schema_version", REEF_SCHEMA_VERSION);
      span.setAttribute("created_table_count", 0);
      return;
    }
    const schemaUpToDate = verifiedStoredVersion >= REEF_SCHEMA_VERSION;
    span.setAttribute("schema_version", verifiedStoredVersion);
    span.setAttribute("desired_schema_version", REEF_SCHEMA_VERSION);

    if (schemaUpToDate && missing.length === 0) {
      span.setAttribute("created_table_count", 0);
      return;
    }

    await Promise.all(
      missing.map((manifest) => createMissingTable(adapter, vault, manifest)),
    );

    if (
      verifiedStoredVersion > 0 &&
      verifiedStoredVersion < REEF_SCHEMA_VERSION &&
      !requireSchemaVerification
    ) {
      span.setAttribute("created_table_count", missing.length);
      return;
    }

    tables = await listAkbTables(adapter, vault);
    if (canVerifySchema(tables, verificationManifests)) {
      assertDesiredTablesMatch(tables, verificationManifests);
      await stampSchemaVersion(adapter, vault);
    }

    span.setAttribute("created_table_count", missing.length);
  });
}
