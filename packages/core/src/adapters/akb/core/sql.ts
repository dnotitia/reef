import { ZodError, z } from "zod";
import { AkbApiError, SchemaValidationError } from "../../../errors";
import type { ReefTableName } from "./constants";
import type { AkbAdapter } from "./http";

// ─── SQL values and identifiers ───────────────────────────────────────────────
//
// akb exposes a DML SQL endpoint at `POST /api/v1/tables/{vault}/sql`. Values
// use PostgreSQL positional parameters; identifiers still need to be rendered
// as part of the statement and are handled by `quoteIdent` / `tableRef`.

export const AkbSqlQueryResponseSchema = z.object({
  kind: z.literal("table_query"),
  columns: z.array(z.string()),
  items: z.array(z.record(z.string(), z.unknown())),
  total: z.number(),
  vaults: z.array(z.string()).optional(),
});

export const AkbSqlMutationResponseSchema = z.object({
  kind: z.literal("table_sql"),
  result: z.string(),
  vaults: z.array(z.string()).optional(),
});

export const AkbSqlResponseSchema = z.discriminatedUnion("kind", [
  AkbSqlQueryResponseSchema,
  AkbSqlMutationResponseSchema,
]);

export type AkbSqlResponse = z.infer<typeof AkbSqlResponseSchema>;

function rejectNul(value: string, fieldDescriptor: string): void {
  if (value.includes("\0")) {
    throw new SchemaValidationError({
      issues: [`${fieldDescriptor} must not contain a NUL byte`],
    });
  }
}

type SqlScalar = string | number | boolean | null;

function normalizeSqlScalar(
  value: unknown,
  fieldDescriptor: string,
): SqlScalar {
  if (value == null) return null;
  if (typeof value === "string") {
    rejectNul(value, fieldDescriptor);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new SchemaValidationError({
        issues: [`${fieldDescriptor} must be a finite number`],
      });
    }
    return value;
  }
  if (typeof value === "boolean") return value;
  throw new SchemaValidationError({
    issues: [`${fieldDescriptor} must be a SQL scalar value`],
  });
}

/** Serialize a JSON/JSONB value while preserving the adapter's validation errors. */
export function serializeJsonValue(
  value: unknown,
  fieldDescriptor = "json value",
): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, (key, nestedValue) => {
      if (key.length > 0) {
        rejectNul(key, fieldDescriptor);
      }
      if (
        nestedValue === undefined ||
        typeof nestedValue === "function" ||
        typeof nestedValue === "symbol"
      ) {
        throw new SchemaValidationError({
          issues: [`${fieldDescriptor} is not JSON-serializable`],
        });
      }
      if (typeof nestedValue === "number" && !Number.isFinite(nestedValue)) {
        throw new SchemaValidationError({
          issues: [`${fieldDescriptor} must contain finite numbers`],
        });
      }
      if (typeof nestedValue === "string") {
        rejectNul(nestedValue, fieldDescriptor);
      }
      return nestedValue;
    });
  } catch (err) {
    if (err instanceof SchemaValidationError) throw err;
    throw new SchemaValidationError({
      issues: [`${fieldDescriptor} is not JSON-serializable`],
    });
  }
  if (serialized === undefined) {
    throw new SchemaValidationError({
      issues: [`${fieldDescriptor} is not JSON-serializable`],
    });
  }
  return serialized;
}

/** Build `$1..$n` placeholders and the corresponding validated request values. */
export class SqlParameterBuilder {
  private readonly values: SqlScalar[] = [];

  get params(): readonly SqlScalar[] {
    return this.values;
  }

  add(value: unknown, fieldDescriptor = "SQL parameter"): string {
    this.values.push(normalizeSqlScalar(value, fieldDescriptor));
    return `$${this.values.length}`;
  }

  addInt(
    value: number | null | undefined,
    fieldDescriptor = "SQL integer parameter",
  ): string {
    if (value != null && !Number.isInteger(value)) {
      throw new SchemaValidationError({
        issues: [`${fieldDescriptor} must be an integer`],
      });
    }
    return this.add(value, fieldDescriptor);
  }

  addJson(
    value: unknown,
    fieldDescriptor = "json value",
    cast: "json" | "jsonb" = "json",
  ): string {
    const serialized = serializeJsonValue(value, fieldDescriptor);
    this.values.push(serialized);
    return `$${this.values.length}::${cast}`;
  }
}

export function quoteText(value: string, fieldDescriptor: string): string {
  rejectNul(value, fieldDescriptor);
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteTextOrNull(
  value: string | null | undefined,
  fieldDescriptor: string,
): string {
  if (value == null) return "NULL";
  return quoteText(value, fieldDescriptor);
}

export function quoteIntOrNull(value: number | null | undefined): string {
  if (value == null) return "NULL";
  if (!Number.isInteger(value)) {
    throw new SchemaValidationError({
      issues: ["expected integer value for SQL int column"],
    });
  }
  return String(value);
}

export function quoteNumberOrNull(value: number | null | undefined): string {
  if (value == null) return "NULL";
  if (!Number.isFinite(value)) {
    throw new SchemaValidationError({
      issues: ["expected finite number value for SQL number column"],
    });
  }
  return String(value);
}

export function quoteJson(value: unknown): string {
  const serialized = serializeJsonValue(value);
  return `'${serialized.replace(/'/g, "''")}'::json`;
}

export function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new SchemaValidationError({
      issues: [`invalid SQL identifier: ${name}`],
    });
  }
  return `"${name}"`;
}

/**
 * Render a table name for an akb SQL statement as a BARE (unquoted)
 * identifier. akb's server-side `table_query` rewriter maps a friendly table
 * name (`reef_issues`) to its physical PG name (`vt_<vault>__reef_issues`),
 * but as of akb 0.3.1 that rewriter is token-aware: it rewrites just bare
 * identifier tokens and passes double-quoted identifiers through verbatim
 * (to preserve PG's case-sensitivity for quoted names). A quoted
 * `"reef_issues"` therefore skips the rewrite and fails with
 * `relation "reef_issues" does not exist`. Use this for table references;
 * keep `quoteIdent` for column names (which may be keyword-like, e.g. `key`).
 *
 * The input type is narrowed to `ReefTableName` (closed union of the table
 * constants in `constants.ts`) so callers does not pass arbitrary strings —
 * adding a new table requires registering it in `REEF_TABLE_NAMES`, which is
 * where the lowercase / non-keyword invariant is enforced by code review. The
 * runtime regex below is defense-in-depth for anyone who slips a value
 * through via cast or JS interop.
 */
export function tableRef(name: ReefTableName): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new SchemaValidationError({
      issues: [`invalid SQL table name: ${name}`],
    });
  }
  return name;
}

export async function runSql(
  adapter: AkbAdapter,
  vault: string,
  sql: string,
  params?: readonly unknown[],
): Promise<AkbSqlResponse> {
  // Keep validation at this boundary because callers may provide raw params;
  // builder output is validated again when it crosses into the adapter.
  let normalizedParams: SqlScalar[] | undefined;
  if (params !== undefined) {
    if (!Array.isArray(params)) {
      throw new SchemaValidationError({
        issues: ["SQL params must be an array"],
      });
    }
    normalizedParams = params.map((value, index) =>
      normalizeSqlScalar(value, `SQL parameter ${index + 1}`),
    );
  }
  const payload = await adapter.request(
    `/api/v1/tables/${encodeURIComponent(vault)}/sql`,
    {
      method: "POST",
      body:
        normalizedParams === undefined
          ? { sql }
          : { sql, params: normalizedParams },
      resource: `sql on vault ${vault}`,
    },
  );
  // akb returns SQL *runtime* errors (e.g. "relation does not exist") as an
  // HTTP 200 with `{ error: <postgres message> }`. translateAkbHttpError
  // does not fires for these — so detect the envelope here and throw an
  // AkbApiError carrying the raw message so `isMissingTableError` can pattern
  // match against `err.context.message`.
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    throw new AkbApiError({
      status: 200,
      message: String((payload as { error: unknown }).error),
    });
  }
  try {
    return AkbSqlResponseSchema.parse(payload);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw err;
  }
}

/**
 * Pattern-match the akb error message that surfaces a Postgres "relation does
 * not exist" — fired when reef reads from `reef_settings` or `monitored_repos`
 * on a vault that has not been onboarded. Used by `readConfig` to downgrade
 * to `DEFAULT_CONFIG` instead of propagating an error.
 *
 * Note: `err.message` on our error classes is the sanitized user-facing copy;
 * the raw upstream message lives on `err.context.message`. We scan that.
 */
export function isMissingTableError(err: unknown): boolean {
  let raw = "";
  if (err instanceof AkbApiError) {
    raw = err.context.message ?? "";
  } else if (err instanceof SchemaValidationError) {
    raw = err.context.issues?.join(" ") ?? "";
  } else {
    return false;
  }
  const message = raw.toLowerCase();
  return message.includes("does not exist") && message.includes("relation");
}

/**
 * JSON/JSONB columns round-trip through akb's SQL endpoint as the JSON text
 * representation. Decode if it parses as JSON, otherwise return the raw value.
 */
export function decodeSettingsValue(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
