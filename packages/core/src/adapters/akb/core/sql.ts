import { ZodError, z } from "zod";
import { AkbApiError, SchemaValidationError } from "../../../errors";
import type { ReefTableName } from "./constants";
import { type AkbAdapter, sanitizeCredentialSafeAkbCode } from "./http";

// ─── SQL escaping ─────────────────────────────────────────────────────────────
//
// akb exposes a DML SQL endpoint at `POST /api/v1/tables/{vault}/sql`. The
// endpoint takes a raw string — NO parameter binding — so every value reef
// hand-writes into a SQL statement should pass through these escape helpers.
// Layered defenses:
//
//   1. Zod validates incoming Config (owner/name regex, github_id integer)
//      before any value reaches the SQL string.
//   2. `rejectNul` blocks NUL bytes that Postgres TEXT would refuse anyway.
//   3. Single-quote escaping via `''` doubling — the just sanctioned Postgres
//      escape with `standard_conforming_strings = on` (the default).
//
// `quoteIdent` is included for completeness even though reef  passes
// constant identifiers (table/column names from `constants.ts`).

export const AkbSqlQueryResponseSchema = z.object({
  kind: z.literal("table_query"),
  columns: z.array(z.string()),
  items: z.array(z.record(z.unknown())),
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
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new SchemaValidationError({
      issues: ["value is not JSON-serializable"],
    });
  }
  rejectNul(serialized, "json value");
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
): Promise<AkbSqlResponse> {
  const payload = await adapter.request(
    `/api/v1/tables/${encodeURIComponent(vault)}/sql`,
    {
      method: "POST",
      body: { sql },
      resource: `sql on vault ${vault}`,
    },
  );
  // akb returns SQL *runtime* errors (e.g. "relation does not exist") as an
  // HTTP 200 with `{ error: <postgres message> }`. translateAkbHttpError does
  // not fire for these, so detect the envelope here. Service adapters retain
  // only the stable code needed for control flow; user adapters preserve the
  // legacy message-based fallback.
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    const upstreamMessage = String((payload as { error: unknown }).error);
    const code =
      "code" in payload && typeof payload.code === "string"
        ? payload.code
        : undefined;
    const controlCode =
      code ??
      (isMissingRelationMessage(upstreamMessage)
        ? "undefined_table"
        : undefined);
    throw new AkbApiError({
      status: 200,
      message: adapter.credentialSafeErrors
        ? "akb_upstream_error_200"
        : upstreamMessage,
      code: adapter.credentialSafeErrors
        ? sanitizeCredentialSafeAkbCode(controlCode)
        : controlCode,
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
    if (err.context.code === "undefined_table") return true;
    raw = err.context.message ?? "";
  } else if (err instanceof SchemaValidationError) {
    raw = err.context.issues?.join(" ") ?? "";
  } else {
    return false;
  }
  return isMissingRelationMessage(raw);
}

function isMissingRelationMessage(raw: string): boolean {
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
