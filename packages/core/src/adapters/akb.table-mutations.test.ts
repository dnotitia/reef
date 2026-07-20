import { describe, expect, it } from "vitest";
import {
  AkbApiError,
  type AkbTableMigrationOperation,
  AkbTableMutationColumnTypeSchema,
  AuthError,
  ConflictError,
  NotFoundError,
  SchemaValidationError,
  akbAlterTable,
  akbApplyTableMigration,
} from "../index";
import { makeAdapter, setupFetch } from "./akb.httpTestSupport";

const IDEMPOTENCY_KEY = "018f47a4-8e3b-7f62-a3d2-9876543210ab";

function tableResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "table",
    uri: "akb://reef-test/table/reef_issues",
    vault: "reef-test",
    name: "reef_issues",
    columns: [{ name: "reef_id", type: "text", server_extension: true }],
    unique_keys: [],
    indexes: [],
    ...overrides,
  };
}

function migrationResult(
  applied: boolean,
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: "table_migration",
    vault: "reef-test",
    idempotency_key: IDEMPOTENCY_KEY,
    checksum: "a".repeat(64),
    applied,
    applied_at: "2026-07-20T00:00:00+00:00",
    operations: 1,
    results: [],
    ...overrides,
  };
}

const oneOperation: AkbTableMigrationOperation[] = [
  {
    op: "add_column",
    table: "reef_issues",
    column: { name: "requester", type: "text", upstream_extension: "kept" },
  },
];

describe("akb table mutation helpers", () => {
  it("covers every AKB dynamic column type in the public Zod contract", () => {
    expect(AkbTableMutationColumnTypeSchema.options).toEqual([
      "text",
      "int",
      "float",
      "numeric",
      "number",
      "boolean",
      "uuid",
      "date",
      "timestamp",
      "jsonb",
      "json",
      "text[]",
      "enum",
    ]);
  });

  it("percent-encodes direct-alter path segments and preserves request/response extensions", async () => {
    const { calls } = setupFetch([
      {
        body: tableResult({
          response_extension: { version: 2 },
          columns: [
            {
              name: "외부/id",
              type: "uuid",
              references: { table: "users", column: "id" },
            },
          ],
        }),
      },
    ]);
    const changes = {
      add_columns: [
        {
          name: "외부/id",
          type: "uuid" as const,
          references: { table: "users", column: "id" },
        },
      ],
      rename_columns: { legacy_owner: "owner/이름" },
      add_indexes: [
        {
          name: "idx_owner",
          columns: [{ name: "owner/이름", order: "desc" }],
          predicate: "owner IS NOT NULL",
        },
      ],
    };

    const result = await akbAlterTable({
      adapter: makeAdapter(),
      vault: "team/한글",
      table: "issue/raw",
      changes,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://akb.test/api/v1/tables/team%2F%ED%95%9C%EA%B8%80/issue%2Fraw",
    );
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(changes);
    expect(result.response_extension).toEqual({ version: 2 });
    expect(result.columns[0]).toMatchObject({
      name: "외부/id",
      references: { table: "users", column: "id" },
    });
  });

  it("sends the caller UUID and raw operations unchanged, preserving replay applied:false", async () => {
    const { calls } = setupFetch([
      { body: migrationResult(true) },
      { body: migrationResult(false) },
    ]);
    const adapter = makeAdapter();

    const first = await akbApplyTableMigration({
      adapter,
      vault: "team/한글",
      idempotencyKey: IDEMPOTENCY_KEY,
      operations: oneOperation,
    });
    const replay = await akbApplyTableMigration({
      adapter,
      vault: "team/한글",
      idempotencyKey: IDEMPOTENCY_KEY,
      operations: oneOperation,
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.url)).toEqual([
      "https://akb.test/api/v1/tables/team%2F%ED%95%9C%EA%B8%80/migrations",
      "https://akb.test/api/v1/tables/team%2F%ED%95%9C%EA%B8%80/migrations",
    ]);
    for (const call of calls) {
      expect(call.init?.method).toBe("POST");
      expect(new Headers(call.init?.headers).get("Idempotency-Key")).toBe(
        IDEMPOTENCY_KEY,
      );
      expect(JSON.parse(String(call.init?.body))).toEqual(oneOperation);
    }
    expect(first.applied).toBe(true);
    expect(replay.applied).toBe(false);
  });

  it("accepts exactly the eight migration op variants and preserves nested extension fields", async () => {
    const operations: AkbTableMigrationOperation[] = [
      {
        op: "add_column",
        table: "issues",
        column: { name: "state", type: "enum", enum: ["todo", "done"] },
      },
      {
        op: "alter_column",
        table: "issues",
        column: { name: "state", set_default: "todo" },
      },
      { op: "drop_column", table: "issues", name: "legacy" },
      {
        op: "rename_column",
        table: "issues",
        from: "owner",
        to: "assignee",
      },
      {
        op: "add_unique_key",
        table: "issues",
        unique_key: {
          name: "uq_issue",
          columns: ["reef_id"],
          nulls_not_distinct: true,
        },
      },
      { op: "drop_unique_key", table: "issues", name: "uq_legacy" },
      {
        op: "add_index",
        table: "issues",
        index: {
          name: "idx_status",
          columns: [{ name: "status", order: "desc" }],
          method: "btree",
        },
      },
      { op: "drop_index", table: "issues", name: "idx_legacy" },
    ];
    const { calls } = setupFetch([
      { body: migrationResult(true, { operations: operations.length }) },
    ]);

    const result = await akbApplyTableMigration({
      adapter: makeAdapter(),
      vault: "reef-test",
      idempotencyKey: IDEMPOTENCY_KEY,
      operations,
    });

    expect(result.operations).toBe(8);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(operations);
  });

  it("rejects an invalid UUID, empty operations, unknown op, and top-level typos before fetch", async () => {
    const { calls } = setupFetch([]);
    const adapter = makeAdapter();
    const invoke = (input: {
      idempotencyKey: string;
      operations: unknown[];
    }) =>
      akbApplyTableMigration({
        adapter,
        vault: "reef-test",
        idempotencyKey: input.idempotencyKey,
        operations: input.operations as AkbTableMigrationOperation[],
      });

    await expect(
      invoke({ idempotencyKey: "not-a-uuid", operations: oneOperation }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      invoke({ idempotencyKey: IDEMPOTENCY_KEY, operations: [] }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      invoke({
        idempotencyKey: IDEMPOTENCY_KEY,
        operations: [{ op: "vacuum_table", table: "issues" }],
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      invoke({
        idempotencyKey: IDEMPOTENCY_KEY,
        operations: [
          {
            op: "drop_column",
            table: "issues",
            name: "legacy",
            typo: true,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });

  it("maps same-key/different-operation migration conflicts to ConflictError", async () => {
    setupFetch([
      { body: migrationResult(true) },
      { status: 409, body: { detail: "idempotency key checksum conflict" } },
    ]);
    const adapter = makeAdapter();
    await akbApplyTableMigration({
      adapter,
      vault: "reef-test",
      idempotencyKey: IDEMPOTENCY_KEY,
      operations: oneOperation,
    });

    await expect(
      akbApplyTableMigration({
        adapter,
        vault: "reef-test",
        idempotencyKey: IDEMPOTENCY_KEY,
        operations: [
          { op: "drop_column", table: "reef_issues", name: "requester" },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it.each([
    [401, AuthError],
    [403, AuthError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, SchemaValidationError],
    [500, AkbApiError],
  ] as const)(
    "preserves adapter error translation for direct alter HTTP %s",
    async (status, ErrorType) => {
      setupFetch([{ status, body: { detail: `upstream ${status}` } }]);
      await expect(
        akbAlterTable({
          adapter: makeAdapter(),
          vault: "reef-test",
          table: "reef_issues",
          changes: { drop_columns: ["legacy"] },
        }),
      ).rejects.toBeInstanceOf(ErrorType);
    },
  );

  it.each([
    [401, AuthError],
    [403, AuthError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, SchemaValidationError],
    [500, AkbApiError],
  ] as const)(
    "preserves adapter error translation for migration HTTP %s",
    async (status, ErrorType) => {
      setupFetch([{ status, body: { detail: `upstream ${status}` } }]);
      await expect(
        akbApplyTableMigration({
          adapter: makeAdapter(),
          vault: "reef-test",
          idempotencyKey: IDEMPOTENCY_KEY,
          operations: oneOperation,
        }),
      ).rejects.toBeInstanceOf(ErrorType);
    },
  );

  it("rejects malformed successful envelopes as SchemaValidationError", async () => {
    setupFetch([
      { body: { kind: "table", vault: "reef-test" } },
      { body: { kind: "table_migration", applied: true } },
    ]);
    const adapter = makeAdapter();

    await expect(
      akbAlterTable({
        adapter,
        vault: "reef-test",
        table: "reef_issues",
        changes: {},
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(
      akbApplyTableMigration({
        adapter,
        vault: "reef-test",
        idempotencyKey: IDEMPOTENCY_KEY,
        operations: oneOperation,
      }),
    ).rejects.toBeInstanceOf(SchemaValidationError);
  });
});
