import { z } from "zod";
import {
  AkbApiError,
  AuthError,
  WorkspaceReadinessError,
  isAkbAccountErrorCode,
} from "../../../errors";
import {
  AkbTableColumnTypeSchema,
  canonicalReefTableProjection,
  REEF_DESIRED_TABLES,
} from "./tableManifest";
import type { AkbAdapter } from "./http";
import { withSpan } from "./tracing";

const NonEmptyStringSchema = z.string().min(1);
const TableColumnSchema = z.looseObject({
  name: NonEmptyStringSchema,
  type: AkbTableColumnTypeSchema,
  required: z.boolean(),
});
const UniqueKeySchema = z.looseObject({
  name: NonEmptyStringSchema.optional(),
  columns: z.array(NonEmptyStringSchema).min(1),
});
const IndexColumnSchema = z.union([
  NonEmptyStringSchema,
  z.looseObject({
    name: NonEmptyStringSchema,
    order: z.enum(["asc", "desc"]).optional(),
  }),
]);
const IndexSchema = z.looseObject({
  name: NonEmptyStringSchema.optional(),
  columns: z.array(IndexColumnSchema).min(1),
});
const TableSchema = z.looseObject({
  name: NonEmptyStringSchema,
  columns: z.array(TableColumnSchema),
  unique_keys: z.array(UniqueKeySchema),
  indexes: z.array(IndexSchema),
});
const TableListSchema = z.looseObject({
  kind: z.literal("table"),
  vault: NonEmptyStringSchema,
  items: z.array(z.unknown()),
});

type ReadinessFailure =
  | "required_tables_missing"
  | "required_tables_mismatch"
  | "required_tables_forbidden"
  | "required_tables_unavailable"
  | "required_tables_transport"
  | "required_tables_invalid_response";

function throwReadinessFailure(
  reason: ReadinessFailure,
  canManage: boolean,
): never {
  if (!canManage) {
    throw new WorkspaceReadinessError({
      reason: "owner_action_required",
      status: 403,
    });
  }
  const status =
    reason === "required_tables_forbidden"
      ? 403
      : reason === "required_tables_unavailable" ||
          reason === "required_tables_transport"
        ? 503
        : reason === "required_tables_invalid_response"
          ? 502
          : 409;
  throw new WorkspaceReadinessError({ reason, status });
}

function parseTableList(
  payload: unknown,
  vault: string,
  canManage: boolean,
): Array<z.infer<typeof TableSchema>> {
  const envelope = TableListSchema.safeParse(payload);
  if (!envelope.success || envelope.data.vault !== vault) {
    return throwReadinessFailure("required_tables_invalid_response", canManage);
  }

  const parsedTables: Array<z.infer<typeof TableSchema>> = [];
  const names = new Set<string>();
  for (const item of envelope.data.items) {
    const table = TableSchema.safeParse(item);
    if (!table.success || names.has(table.data.name)) {
      return throwReadinessFailure(
        "required_tables_invalid_response",
        canManage,
      );
    }
    names.add(table.data.name);
    parsedTables.push(table.data);
  }
  return parsedTables;
}

function canonicalActualTable(table: z.infer<typeof TableSchema>): string {
  const canonical = canonicalReefTableProjection({
    name: table.name,
    columns: table.columns.map(({ name, type, required }) => ({
      name,
      type,
      required,
    })),
    unique_keys: table.unique_keys.map(({ columns }) => ({ columns })),
    indexes: table.indexes.map(({ columns }) => ({
      columns: columns.map((column) =>
        typeof column === "string"
          ? column
          : { name: column.name, order: column.order },
      ),
    })),
  });
  return JSON.stringify(canonical);
}

function canonicalExpectedTable(
  table: (typeof REEF_DESIRED_TABLES)[number],
): string {
  return JSON.stringify(canonicalReefTableProjection(table));
}

/**
 * Read AKB's table catalog and require an exact logical match for Reef's
 * canonical schema. This boundary is intentionally GET-only: it does not
 * create, alter, drop, migrate, or stamp tables.
 */
export async function verifyRequiredTables(params: {
  adapter: AkbAdapter;
  vault: string;
  canManage: boolean;
}): Promise<void> {
  const { adapter, vault, canManage } = params;
  return withSpan(
    "akb.tables.verify_required",
    { vault, "workspace.can_manage": canManage },
    async (span) => {
      let payload: unknown;
      try {
        payload = await adapter.request(
          `/api/v1/tables/${encodeURIComponent(vault)}`,
          { resource: `tables in vault ${vault}` },
        );
      } catch (error) {
        if (error instanceof AuthError) {
          if (
            error.context.status === 401 ||
            isAkbAccountErrorCode(error.context.code)
          ) {
            throw error;
          }
          if (error.context.status === 403) {
            return throwReadinessFailure(
              "required_tables_forbidden",
              canManage,
            );
          }
        }
        if (error instanceof AkbApiError) {
          if (error.status === 0) {
            return throwReadinessFailure(
              "required_tables_transport",
              canManage,
            );
          }
          if (error.status === 429 || error.status >= 500) {
            return throwReadinessFailure(
              "required_tables_unavailable",
              canManage,
            );
          }
        }
        throw error;
      }

      const tables = parseTableList(payload, vault, canManage);
      const byName = new Map(tables.map((table) => [table.name, table]));
      span.setAttribute("required_table_count", REEF_DESIRED_TABLES.length);
      span.setAttribute("observed_table_count", tables.length);

      for (const expected of REEF_DESIRED_TABLES) {
        const actual = byName.get(expected.name);
        if (!actual) {
          return throwReadinessFailure("required_tables_missing", canManage);
        }
        try {
          if (
            canonicalActualTable(actual) !== canonicalExpectedTable(expected)
          ) {
            return throwReadinessFailure("required_tables_mismatch", canManage);
          }
        } catch (error) {
          if (error instanceof WorkspaceReadinessError) throw error;
          return throwReadinessFailure(
            "required_tables_invalid_response",
            canManage,
          );
        }
      }
    },
  );
}
