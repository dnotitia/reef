import type { AkbTableMigrationOperation } from "@reef/core";

export interface MigrationPhase {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly idempotencyKey: string;
  readonly operations: readonly AkbTableMigrationOperation[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const freezePhase = (phase: MigrationPhase): MigrationPhase =>
  Object.freeze({
    ...phase,
    operations: Object.freeze(
      phase.operations.map((operation) =>
        Object.freeze(structuredClone(operation)),
      ),
    ),
  });

export function defineMigrationCatalog(
  phases: readonly MigrationPhase[],
): readonly MigrationPhase[] {
  const keys = new Set<string>();
  let previousTo = -1;
  const validated = phases.map((phase, index) => {
    if (
      !Number.isInteger(phase.fromVersion) ||
      !Number.isInteger(phase.toVersion) ||
      phase.fromVersion < 0 ||
      phase.toVersion <= phase.fromVersion
    ) {
      throw new Error("migration_catalog_invalid_version");
    }
    if (
      !UUID_PATTERN.test(phase.idempotencyKey) ||
      keys.has(phase.idempotencyKey)
    ) {
      throw new Error("migration_catalog_invalid_idempotency_key");
    }
    if (phase.operations.length === 0) {
      throw new Error("migration_catalog_empty_phase");
    }
    if (index > 0 && phase.fromVersion !== previousTo) {
      throw new Error("migration_catalog_non_contiguous");
    }
    keys.add(phase.idempotencyKey);
    previousTo = phase.toVersion;
    return freezePhase(phase);
  });
  return Object.freeze(validated);
}

// REEF-414 establishes the catalog boundary without changing the Reef schema.
export const REEF_MIGRATION_CATALOG = defineMigrationCatalog([]);

export function pendingMigrationPhases(
  currentVersion: number,
  targetVersion: number,
  catalog: readonly MigrationPhase[] = REEF_MIGRATION_CATALOG,
): readonly MigrationPhase[] {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error("migration_schema_version_invalid");
  }
  if (currentVersion > targetVersion) {
    throw new Error("migration_schema_version_ahead");
  }
  return catalog.filter(
    (phase) =>
      phase.fromVersion >= currentVersion && phase.toVersion <= targetVersion,
  );
}
