// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SchemaLifecycleError } from "../../../errors";
import {
  type WorkspaceMigrationCatalogEntry,
  createWorkspaceMigrationCatalog,
} from "./catalog";

const operation: WorkspaceMigrationCatalogEntry["operations"][number] = {
  op: "add_column" as const,
  table: "reef_issues",
  column: { name: "sample", type: "text" },
};

describe("workspace migration catalog", () => {
  it("deep-freezes a continuous fixed-UUID catalog", () => {
    const catalog = createWorkspaceMigrationCatalog(
      [
        {
          fromVersion: 1,
          toVersion: 2,
          phaseId: "11111111-1111-4111-8111-111111111111",
          operations: [operation],
        },
        {
          fromVersion: 2,
          toVersion: 3,
          phaseId: "22222222-2222-4222-8222-222222222222",
          operations: [{ ...operation, table: "reef_comments" }],
        },
      ],
      3,
    );
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.entries)).toBe(true);
    expect(Object.isFrozen(catalog.entries[0]?.operations[0])).toBe(true);
  });

  it.each([
    [
      [
        {
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
          fromVersion: 1,
          toVersion: 2,
          phaseId: "11111111-1111-4111-8111-111111111111",
          operations: [operation],
        },
        {
          fromVersion: 3,
          toVersion: 4,
          phaseId: "22222222-2222-4222-8222-222222222222",
          operations: [operation],
        },
      ],
      4,
    ],
    [
      [
        {
          fromVersion: 1,
          toVersion: 2,
          phaseId: "11111111-1111-4111-8111-111111111111",
          operations: [operation],
        },
      ],
      3,
    ],
  ])(
    "rejects gaps, discontinuity, and target-ahead catalogs",
    (entries, target) => {
      expect(() => createWorkspaceMigrationCatalog(entries, target)).toThrow(
        SchemaLifecycleError,
      );
    },
  );
});
