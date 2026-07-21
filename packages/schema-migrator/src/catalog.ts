import type { AkbTableMigrationOperation } from "@reef/core";

export interface MigrationPhase {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly idempotencyKey: string;
  readonly operations: readonly AkbTableMigrationOperation[];
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const freezePhase = (phase: MigrationPhase): MigrationPhase =>
  Object.freeze({
    ...phase,
    operations: Object.freeze(
      phase.operations.map((operation) =>
        deepFreeze(structuredClone(operation)),
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
  if (currentVersion === targetVersion) return [];
  // Version 0 also represents a vault without Reef tables or a schema stamp.
  // An intentionally empty release catalog delegates that baseline creation
  // and target-version stamp to the runner's final ensureReefTables step.
  if (catalog.length === 0) return [];

  const pending: MigrationPhase[] = [];
  let nextVersion = currentVersion;
  while (nextVersion < targetVersion) {
    const phase = catalog.find(
      (candidate) =>
        candidate.fromVersion === nextVersion &&
        candidate.toVersion <= targetVersion,
    );
    if (!phase) throw new Error("migration_catalog_incomplete_chain");
    pending.push(phase);
    nextVersion = phase.toVersion;
  }
  return pending;
}
