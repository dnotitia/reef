import { z } from "zod";
import { SchemaLifecycleError } from "../../../errors";
import { REEF_SCHEMA_VERSION } from "../core/tableManifest";
import {
  type AkbTableMigrationOperation,
  AkbTableMigrationOperationsSchema,
} from "../core/tables";

const CatalogEntrySchema = z
  .object({
    fromVersion: z.number().int().nonnegative(),
    toVersion: z.number().int().positive(),
    phaseId: z.string().uuid(),
    operations: AkbTableMigrationOperationsSchema,
  })
  .strict();

export interface WorkspaceMigrationCatalogEntry {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly phaseId: string;
  readonly operations: readonly AkbTableMigrationOperation[];
}

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
  const cloned = entries.map((entry) =>
    CatalogEntrySchema.parse(structuredClone(entry)),
  );
  const phaseIds = new Set<string>();
  for (const [index, entry] of cloned.entries()) {
    if (
      entry.toVersion !== entry.fromVersion + 1 ||
      (index > 0 && cloned[index - 1]?.toVersion !== entry.fromVersion) ||
      phaseIds.has(entry.phaseId)
    ) {
      throw new SchemaLifecycleError({ reason: "migration_catalog_invalid" });
    }
    phaseIds.add(entry.phaseId);
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
