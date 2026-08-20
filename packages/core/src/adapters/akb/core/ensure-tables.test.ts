import { describe, expect, it } from "vitest";
import {
  ALL_REEF_TABLES,
  REEF_DESIRED_TABLES,
  REEF_SCHEMA_VERSION,
  ensureReefTables,
  makeAdapter,
  makeListTablesResponse,
  makeSchemaVersionResponse,
  setupFetch,
} from "./akb.testSupport";

describe("ensureReefTables", () => {
  it("creates the fresh desired manifest without the removed activity table", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse([]) },
      ...REEF_DESIRED_TABLES.map((table) => ({
        status: 201,
        body: { name: table.name },
      })),
      { body: makeSchemaVersionResponse(REEF_SCHEMA_VERSION) },
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
  });

  it("does not create anything when every retained table exists", async () => {
    const { calls } = setupFetch([
      { body: makeListTablesResponse(ALL_REEF_TABLES) },
      { body: makeSchemaVersionResponse(REEF_SCHEMA_VERSION) },
      { body: { kind: "table_sql", result: "DELETE 0" } },
      { body: { kind: "table_sql", result: "INSERT 0 1" } },
    ]);
    await ensureReefTables({ adapter: makeAdapter(), vault: "reef-sample" });
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
    expect(
      calls
        .slice(1)
        .some(
          (call) =>
            call.init?.method === "POST" &&
            call.url.endsWith("/tables/reef-sample"),
        ),
    ).toBe(false);
  });
});
