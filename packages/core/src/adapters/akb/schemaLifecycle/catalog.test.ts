// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SchemaLifecycleError } from "../../../errors";
import type { AkbTableMigrationOperation } from "../core/tables";
import {
  type WorkspaceMigrationCatalogEntry,
  createWorkspaceMigrationCatalog,
} from "./catalog";

const operation: AkbTableMigrationOperation = {
  op: "add_column" as const,
  table: "reef_issues",
  column: { name: "sample", type: "text" },
};

const newTableManifest = {
  name: "reef_new_table",
  columns: [{ name: "value", type: "text" as const }],
};

const invalidCatalogs: Array<[WorkspaceMigrationCatalogEntry[], number]> = [
  [
    [
      {
        kind: "operations",
        fromVersion: 1,
        toVersion: 3,
        phaseId: "11111111-1111-4111-8111-111111111111",
        operations: [operation],
      },
    ],
    3,
  ],
  [
    [
      {
        kind: "operations",
        fromVersion: 1,
        toVersion: 2,
        phaseId: "11111111-1111-4111-8111-111111111111",
        operations: [operation],
      },
      {
        kind: "reconcile_only",
        fromVersion: 3,
        toVersion: 4,
        phaseId: "22222222-2222-4222-8222-222222222222",
        manifests: [newTableManifest],
      },
    ],
    4,
  ],
  [
    [
      {
        kind: "operations",
        fromVersion: 1,
        toVersion: 2,
        phaseId: "11111111-1111-4111-8111-111111111111",
        operations: [operation],
      },
    ],
    3,
  ],
];

describe("workspace migration catalog", () => {
  it("deep-freezes a continuous fixed-UUID catalog", () => {
    const catalog = createWorkspaceMigrationCatalog(
      [
        {
          kind: "operations" as const,
          fromVersion: 1,
          toVersion: 2,
          phaseId: "11111111-1111-4111-8111-111111111111",
          operations: [operation],
        },
        {
          kind: "reconcile_only",
          fromVersion: 2,
          toVersion: 3,
          phaseId: "22222222-2222-4222-8222-222222222222",
          manifests: [newTableManifest],
        },
      ],
      3,
    );
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.entries)).toBe(true);
    const first = catalog.entries[0];
    expect(first?.kind).toBe("operations");
    if (first?.kind === "operations") {
      expect(Object.isFrozen(first.operations[0])).toBe(true);
    }
  });

  it.each(invalidCatalogs)(
    "rejects gaps, discontinuity, and target-ahead catalogs",
    (entries, target) => {
      expect(() => createWorkspaceMigrationCatalog(entries, target)).toThrow(
        SchemaLifecycleError,
      );
    },
  );

  it("rejects operations attached to an explicit reconcile-only phase", () => {
    expect(() =>
      createWorkspaceMigrationCatalog(
        [
          {
            kind: "reconcile_only",
            fromVersion: 1,
            toVersion: 2,
            phaseId: "11111111-1111-4111-8111-111111111111",
            manifests: [newTableManifest],
            operations: [operation],
          } as never,
        ],
        2,
      ),
    ).toThrow();
  });
});
