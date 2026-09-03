import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  REEF_DESIRED_TABLES,
  REEF_SCHEMA_VERSION,
  REEF_SETTINGS_TABLE,
  SchemaValidationError,
  ensureReefTables,
  makeAdapter,
  makeListTablesResponse,
  makeSchemaVersionResponse,
  setupFetch,
  sqlRequestBody,
} from "./akb.testSupport";

function makeVerifiableListTablesResponse(
  mutate?: (
    table: (typeof REEF_DESIRED_TABLES)[number],
  ) => Record<string, unknown>,
) {
  return {
    body: {
      kind: "table",
      vault: "reef-sample",
      items: REEF_DESIRED_TABLES.map((table) => ({
        name: table.name,
        columns: table.columns,
        unique_keys: table.unique_keys ?? [],
        indexes: table.indexes ?? [],
        ...(mutate?.(table) ?? {}),
      })),
    },
  };
}

describe("ensureReefTables", () => {
  it("creates the fresh desired manifest without the removed activity table", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse([]) },
      ...REEF_DESIRED_TABLES.map((table) => ({
        status: 201,
        body: { name: table.name },
      })),
      makeVerifiableListTablesResponse(),
      { body: { kind: "table_sql", result: "DELETE 0" } },
      { body: { kind: "table_sql", result: "INSERT 0 1" } },
    ]);
    await ensureReefTables({ adapter: makeAdapter(), vault: "reef-sample" });
    expect(ALL_REEF_TABLES).not.toContain("reef_activity_suggestions");
    expect(REEF_DESIRED_TABLES.map((table) => table.name)).toEqual(
      expect.not.arrayContaining(["reef_activity_suggestions"]),
    );
    const created = calls
      .slice(1, 1 + REEF_DESIRED_TABLES.length)
      .map((call) => JSON.parse(call.init?.body as string).name);
    expect(created).toEqual(REEF_DESIRED_TABLES.map((table) => table.name));
    const issueCreate = calls
      .slice(1, 1 + REEF_DESIRED_TABLES.length)
      .map((call) => JSON.parse(call.init?.body as string))
      .find((body) => body.name === "reef_issues");
    const issueColumns = issueCreate?.columns as
      | Array<{ name: string; type: string }>
      | undefined;
    expect(issueColumns?.map((column) => column.name)).toEqual(
      [...(issueColumns?.map((column) => column.name) ?? [])].sort(),
    );
    expect(issueColumns).toEqual(
      expect.arrayContaining([
        { name: "estimate_points", type: "numeric" },
        { name: "labels", type: "jsonb" },
      ]),
    );
    expect(issueCreate?.unique_keys).toEqual([]);
    expect(issueCreate?.indexes).toEqual([]);
    expect(sqlRequestBody(calls[REEF_DESIRED_TABLES.length + 2])).toEqual({
      sql: "DELETE FROM reef_settings WHERE key = $1",
      params: ["schema_version"],
    });
    const stampRequest = sqlRequestBody(calls[REEF_DESIRED_TABLES.length + 3]);
    expect(stampRequest.sql).toBe(
      "INSERT INTO reef_settings (key, value) VALUES ($1, $2::json)",
    );
    expect(stampRequest.params?.[0]).toBe("schema_version");
    expect(JSON.parse(String(stampRequest.params?.[1]))).toMatchObject({
      version: REEF_SCHEMA_VERSION,
    });
  });

  it("does not create anything when every retained table exists", async () => {
    const { calls } = setupFetch([
      makeVerifiableListTablesResponse(),
      { body: makeSchemaVersionResponse(REEF_SCHEMA_VERSION) },
    ]);
    await ensureReefTables({ adapter: makeAdapter(), vault: "reef-sample" });
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
    expect(calls).toHaveLength(2);
    expect(sqlRequestBody(calls[1])).toEqual({
      sql: "SELECT value FROM reef_settings WHERE key = $1 LIMIT 1",
      params: ["schema_version"],
    });
  });

  it("verifies the manifest and stamps an older schema version with bound JSON", async () => {
    const { calls } = setupFetch([
      makeVerifiableListTablesResponse(),
      { body: makeSchemaVersionResponse(REEF_SCHEMA_VERSION - 1) },
      makeVerifiableListTablesResponse(),
      { body: { kind: "table_sql", result: "DELETE 1" } },
      { body: { kind: "table_sql", result: "INSERT 0 1" } },
    ]);

    await ensureReefTables({ adapter: makeAdapter(), vault: "reef-sample" });

    expect(calls).toHaveLength(5);
    expect(sqlRequestBody(calls[3])).toEqual({
      sql: "DELETE FROM reef_settings WHERE key = $1",
      params: ["schema_version"],
    });
    const stampRequest = sqlRequestBody(calls[4]);
    expect(stampRequest.sql).toBe(
      "INSERT INTO reef_settings (key, value) VALUES ($1, $2::json)",
    );
    expect(stampRequest.params?.[0]).toBe("schema_version");
    expect(JSON.parse(String(stampRequest.params?.[1]))).toMatchObject({
      version: REEF_SCHEMA_VERSION,
    });
  });

  it("rejects an existing Reef table manifest mismatch before schema SQL", async () => {
    const { calls } = setupFetch([
      makeVerifiableListTablesResponse((table) =>
        table.name === REEF_SETTINGS_TABLE
          ? { columns: [{ name: "wrong", type: "text" }] }
          : {},
      ),
    ]);

    await expect(
      ensureReefTables({ adapter: makeAdapter(), vault: "reef-sample" }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(1);
  });
});
