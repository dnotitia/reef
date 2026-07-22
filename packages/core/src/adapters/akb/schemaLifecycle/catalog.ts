import { z } from "zod";
import { SchemaLifecycleError } from "../../../errors";
import {
  type AkbCreateTableRequest,
  AkbTableColumnTypeSchema,
  REEF_SCHEMA_VERSION,
} from "../core/tableManifest";
import {
  type AkbTableMigrationOperation,
  AkbTableMigrationOperationsSchema,
  assertNoAkbManagedColumns,
} from "../core/tables";

const CatalogEntryBaseSchema = z.object({
  fromVersion: z.number().int().nonnegative(),
  toVersion: z.number().int().positive(),
  phaseId: z.string().uuid(),
});

const TableManifestSnapshotSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    columns: z.array(
      z
        .object({
          name: z.string().min(1),
          type: AkbTableColumnTypeSchema,
          required: z.boolean().optional(),
        })
        .strict(),
    ),
    collection: z.string().nullable().optional(),
  })
  .strict();

const CatalogEntrySchema = z.discriminatedUnion("kind", [
  CatalogEntryBaseSchema.extend({
    kind: z.literal("operations"),
    operations: AkbTableMigrationOperationsSchema,
  }).strict(),
  CatalogEntryBaseSchema.extend({
    kind: z.literal("reconcile_only"),
    manifests: z.array(TableManifestSnapshotSchema).min(1),
  }).strict(),
]);

interface WorkspaceMigrationCatalogEntryBase {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly phaseId: string;
}

export interface WorkspaceOperationsMigrationCatalogEntry
  extends WorkspaceMigrationCatalogEntryBase {
  readonly kind: "operations";
  readonly operations: readonly AkbTableMigrationOperation[];
}

export interface WorkspaceReconcileMigrationCatalogEntry
  extends WorkspaceMigrationCatalogEntryBase {
  readonly kind: "reconcile_only";
  /** Immutable create-time table shapes introduced by this version step. */
  readonly manifests: readonly AkbCreateTableRequest[];
}

export type WorkspaceMigrationCatalogEntry =
  | WorkspaceOperationsMigrationCatalogEntry
  | WorkspaceReconcileMigrationCatalogEntry;

export interface WorkspaceMigrationCatalog {
  readonly targetVersion: number;
  readonly entries: readonly WorkspaceMigrationCatalogEntry[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function createWorkspaceMigrationCatalog(
  entries: readonly WorkspaceMigrationCatalogEntry[],
  targetVersion: number = REEF_SCHEMA_VERSION,
): WorkspaceMigrationCatalog {
  let cloned: WorkspaceMigrationCatalogEntry[];
  try {
    cloned = entries.map((entry) =>
      CatalogEntrySchema.parse(structuredClone(entry)),
    );
  } catch {
    throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
  }
  const phaseIds = new Set<string>();
  const introducedTables = new Set<string>();
  for (const [index, entry] of cloned.entries()) {
    if (
      entry.toVersion !== entry.fromVersion + 1 ||
      (index > 0 && cloned[index - 1]?.toVersion !== entry.fromVersion) ||
      phaseIds.has(entry.phaseId)
    ) {
      throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
    }
    phaseIds.add(entry.phaseId);
    if (entry.kind === "reconcile_only") {
      for (const manifest of entry.manifests) {
        try {
          assertNoAkbManagedColumns(manifest);
        } catch {
          throw new SchemaLifecycleError({
            reason: "migration_catalog_invalid",
          });
        }
        if (introducedTables.has(manifest.name)) {
          throw new SchemaLifecycleError({
            reason: "migration_catalog_invalid",
          });
        }
        introducedTables.add(manifest.name);
      }
    }
  }
  if (
    !Number.isInteger(targetVersion) ||
    targetVersion < 1 ||
    (cloned.length > 0 && cloned.at(-1)?.toVersion !== targetVersion)
  ) {
    throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
  }
  return deepFreeze({ targetVersion, entries: cloned });
}

/** REEF-414 deliberately adds no operation and does not bump schema version. */
export const WORKSPACE_MIGRATION_CATALOG = createWorkspaceMigrationCatalog([]);
