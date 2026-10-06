import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../../errors";
import { crossVaultTableRef, SqlParameterBuilder, runSql } from "./sql";
import { makeSqlQueryResponse } from "./sqlTestSupport";
import { makeAdapter, setupFetch, sqlRequestBody } from "./httpTestSupport";

describe("runSql", () => {
  it("omits params when no parameter array is supplied", async () => {
    const { calls } = setupFetch([{ body: makeSqlQueryResponse([], []) }]);

    await runSql(makeAdapter(), "reef-sample", "SELECT 1");

    expect(sqlRequestBody(calls[0])).toEqual({ sql: "SELECT 1" });
  });

  it("includes an explicitly supplied empty params array", async () => {
    const { calls } = setupFetch([{ body: makeSqlQueryResponse([], []) }]);

    await runSql(makeAdapter(), "reef-sample", "SELECT 1", []);

    expect(sqlRequestBody(calls[0])).toEqual({
      sql: "SELECT 1",
      params: [],
    });
  });

  it("sends an explicit vault allowlist for cross-vault SQL", async () => {
    const { calls } = setupFetch([{ body: makeSqlQueryResponse([], []) }]);

    await runSql(
      makeAdapter(),
      "reef-e2e",
      `SELECT * FROM ${crossVaultTableRef("reef-e2e", "reef_issues")}`,
      [],
      ["reef-e2e", "reef-zeta"],
    );

    expect(sqlRequestBody(calls[0])).toEqual({
      sql: "SELECT * FROM reef_e2e__reef_issues",
      params: [],
      vaults: ["reef-e2e", "reef-zeta"],
    });
  });

  it("rejects cross-vault aliases that are invalid, duplicated, or ambiguous", async () => {
    const { calls } = setupFetch([]);
    const adapter = makeAdapter();

    expect(() => crossVaultTableRef("bad/name", "reef_issues")).toThrow(
      SchemaValidationError,
    );
    await expect(
      runSql(adapter, "reef-e2e", "SELECT 1", undefined, ["reef-zeta"]),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      runSql(adapter, "reef-e2e", "SELECT 1", undefined, [
        "reef-e2e",
        "reef-e2e",
      ]),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      runSql(adapter, "reef-e2e", "SELECT 1", undefined, [
        "reef-e2e",
        "reef_e2e",
      ]),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    expect(calls).toHaveLength(0);
  });

  it("serializes scalar values without putting them in the SQL text", async () => {
    const values = ["it's \\ 한글😀", null, 7, 1.5, false];
    const params = new SqlParameterBuilder();
    const placeholders = values.map((value, index) =>
      params.add(value, `value ${index}`),
    );
    const sql = `SELECT ${placeholders.join(", ")}`;
    const { calls } = setupFetch([{ body: makeSqlQueryResponse([], []) }]);

    await runSql(makeAdapter(), "reef-sample", sql, params.params);

    expect(sqlRequestBody(calls[0])).toEqual({ sql, params: values });
    expect(sqlRequestBody(calls[0]).sql).not.toContain("it's");
  });

  it("serializes JSON values and keeps the explicit JSONB cast in SQL", async () => {
    const value = { text: "it's \\ 한글😀", nested: { count: 2 } };
    const params = new SqlParameterBuilder();
    const placeholder = params.addJson(value, "payload", "jsonb");
    const sql = `SELECT ${placeholder}`;
    const { calls } = setupFetch([{ body: makeSqlQueryResponse([], []) }]);

    await runSql(makeAdapter(), "reef-sample", sql, params.params);

    expect(sqlRequestBody(calls[0])).toEqual({
      sql: "SELECT $1::jsonb",
      params: [JSON.stringify(value)],
    });
  });

  it("rejects NUL, non-finite, and non-scalar params before the adapter request", async () => {
    const { calls } = setupFetch([]);
    const adapter = makeAdapter();

    await expect(
      runSql(adapter, "reef-sample", "SELECT $1", ["bad\0value"]),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      runSql(adapter, "reef-sample", "SELECT $1", [Number.NaN]),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      runSql(adapter, "reef-sample", "SELECT $1", [{ nested: true }]),
    ).rejects.toBeInstanceOf(SchemaValidationError);

    expect(calls).toHaveLength(0);
  });

  it("rejects NUL in nested JSON and unserializable JSON before the adapter request", async () => {
    const { calls } = setupFetch([]);
    const params = new SqlParameterBuilder();

    expect(() =>
      params.addJson({ nested: { text: "bad\0value" } }, "payload"),
    ).toThrow(SchemaValidationError);
    expect(() => params.addJson(1n, "payload")).toThrow(SchemaValidationError);

    expect(calls).toHaveLength(0);
  });
});
