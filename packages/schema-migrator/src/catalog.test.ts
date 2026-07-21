import { describe, expect, it } from "vitest";
import {
  REEF_MIGRATION_CATALOG,
  defineMigrationCatalog,
  pendingMigrationPhases,
} from "./catalog";

const FIRST = "018f47a4-8e3b-7f62-a3d2-9876543210ab";
const SECOND = "018f47a4-8e3b-7f62-a3d2-9876543210ac";

describe("migration catalog", () => {
  it("keeps REEF-414 catalog empty without changing the schema version", () => {
    expect(REEF_MIGRATION_CATALOG).toEqual([]);
    expect(Object.isFrozen(REEF_MIGRATION_CATALOG)).toBe(true);
  });

  it("orders fixed UUID phases by version and deeply freezes operations", () => {
    const catalog = defineMigrationCatalog([
      {
        fromVersion: 1,
        toVersion: 2,
        idempotencyKey: FIRST,
        operations: [
          {
            op: "add_column",
            table: "reef_issues",
            column: { name: "future_one", type: "text" },
          },
        ],
      },
      {
        fromVersion: 2,
        toVersion: 3,
        idempotencyKey: SECOND,
        operations: [
          {
            op: "add_column",
            table: "reef_issues",
            column: { name: "future_two", type: "text" },
          },
        ],
      },
    ]);

    expect(
      pendingMigrationPhases(1, 3, catalog).map((p) => p.idempotencyKey),
    ).toEqual([FIRST, SECOND]);
    expect(Object.isFrozen(catalog[0]?.operations)).toBe(true);
    expect(Object.isFrozen(catalog[0]?.operations[0])).toBe(true);
  });

  it.each([
    [
      "duplicate UUID",
      [
        {
          fromVersion: 1,
          toVersion: 2,
          idempotencyKey: FIRST,
          operations: [{ op: "drop_column" as const, table: "t", name: "a" }],
        },
        {
          fromVersion: 2,
          toVersion: 3,
          idempotencyKey: FIRST,
          operations: [{ op: "drop_column" as const, table: "t", name: "b" }],
        },
      ],
    ],
    [
      "version gap",
      [
        {
          fromVersion: 1,
          toVersion: 2,
          idempotencyKey: FIRST,
          operations: [{ op: "drop_column" as const, table: "t", name: "a" }],
        },
        {
          fromVersion: 3,
          toVersion: 4,
          idempotencyKey: SECOND,
          operations: [{ op: "drop_column" as const, table: "t", name: "b" }],
        },
      ],
    ],
  ])("rejects %s", (_label, phases) => {
    expect(() => defineMigrationCatalog(phases)).toThrow(/^migration_catalog_/);
  });
});
