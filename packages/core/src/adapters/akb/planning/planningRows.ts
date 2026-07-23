import { ZodError } from "zod";
import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import {
  type Milestone,
  MilestoneSchema,
  type Release,
  ReleaseSchema,
  type Sprint,
  SprintSchema,
} from "../../../schemas/planning/catalog";
import {
  type AkbAdapter,
  type ReefTableName,
  buildRowAssignments,
  quoteIdent,
  quoteJson,
  quoteNumberOrNull,
  quoteOptionalText,
  quoteText,
  runSql,
  selectIssueRows,
  tableRef,
} from "../core/shared";

function parseOptionalNumber(raw: unknown): number | null | undefined {
  if (raw == null) return undefined;
  const num = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(num) ? num : null;
}

export function rowToSprint(row: Record<string, unknown>): Sprint {
  const candidate = {
    id: row.id,
    name: row.name,
    status: row.status,
    ...(row.start_date != null && { start_date: row.start_date }),
    ...(row.end_date != null && { end_date: row.end_date }),
    goal: typeof row.goal === "string" ? row.goal : "",
    ...(row.capacity_points != null && {
      capacity_points: parseOptionalNumber(row.capacity_points),
    }),
  };
  try {
    return SprintSchema.parse(candidate);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["Sprint row validation failed"],
    });
  }
}

export function rowToMilestone(row: Record<string, unknown>): Milestone {
  const candidate = {
    id: row.id,
    name: row.name,
    status: row.status,
    ...(row.target_date != null && { target_date: row.target_date }),
    description: typeof row.description === "string" ? row.description : "",
  };
  try {
    return MilestoneSchema.parse(candidate);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["Milestone row validation failed"],
    });
  }
}

export function rowToRelease(row: Record<string, unknown>): Release {
  const candidate = {
    id: row.id,
    name: row.name,
    status: row.status,
    ...(row.target_date != null && { target_date: row.target_date }),
    ...(row.released_at != null && { released_at: row.released_at }),
    notes: typeof row.notes === "string" ? row.notes : "",
  };
  try {
    return ReleaseSchema.parse(candidate);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["Release row validation failed"],
    });
  }
}

export async function selectPlanningRows(
  adapter: AkbAdapter,
  vault: string,
  table: ReefTableName,
  where?: string,
): Promise<Record<string, unknown>[]> {
  const sql = `SELECT * FROM ${tableRef(table)}${where ? ` WHERE ${where}` : ""}`;
  const res = await runSql(adapter, vault, sql);
  return res.kind === "table_query" ? res.items : [];
}

export async function assertUniquePlanningName(
  adapter: AkbAdapter,
  vault: string,
  table: ReefTableName,
  name: string,
  excludeId?: string,
): Promise<void> {
  const clauses = [`lower(name) = lower(${quoteText(name, "planning name")})`];
  if (excludeId) {
    clauses.push(`id <> ${quoteText(excludeId, "planning id")}`);
  }
  const rows = await selectPlanningRows(
    adapter,
    vault,
    table,
    clauses.join(" AND "),
  );
  if (rows.length > 0) {
    throw new ConflictError();
  }
}

export function sprintRowFields(
  item: Omit<Sprint, "id">,
  meta: Record<string, unknown> = {},
): Array<[string, string]> {
  return [
    ["name", quoteText(item.name, "sprint name")],
    ["status", quoteText(item.status, "sprint status")],
    ["start_date", quoteOptionalText(item.start_date, "sprint start_date")],
    ["end_date", quoteOptionalText(item.end_date, "sprint end_date")],
    ["goal", quoteText(item.goal ?? "", "sprint goal")],
    ["capacity_points", quoteNumberOrNull(item.capacity_points)],
    ["meta", quoteJson(meta)],
  ];
}

export function milestoneRowFields(
  item: Omit<Milestone, "id">,
): Array<[string, string]> {
  return [
    ["name", quoteText(item.name, "milestone name")],
    ["status", quoteText(item.status, "milestone status")],
    [
      "target_date",
      quoteOptionalText(item.target_date, "milestone target_date"),
    ],
    ["description", quoteText(item.description ?? "", "milestone description")],
    ["meta", quoteJson({})],
  ];
}

export function releaseRowFields(
  item: Omit<Release, "id">,
  meta: Record<string, unknown> = {},
): Array<[string, string]> {
  return [
    ["name", quoteText(item.name, "release name")],
    ["status", quoteText(item.status, "release status")],
    ["target_date", quoteOptionalText(item.target_date, "release target_date")],
    ["released_at", quoteOptionalText(item.released_at, "release released_at")],
    ["notes", quoteText(item.notes ?? "", "release notes")],
    ["meta", quoteJson(meta)],
  ];
}

/**
 * Insert a planning row and return it in a SINGLE statement. akb's `/sql`
 * returns rows for statements that start with SELECT/WITH, so the INSERT is
 * wrapped in a data-modifying CTE: the inserted row — including the akb-assigned
 * uuid `id` — comes back atomically via RETURNING, with no separate read-back.
 *
 * This is what makes creation safe under a concurrent same-name race: each
 * caller gets back its OWN inserted row's id, so there is no post-insert select
 * to race against, no wrong-id, and no 409-after-commit. `id` is does not written;
 * akb auto-assigns the uuid primary key. (Duplicate rows from a same-name race
 * are still possible because akb tables expose no DB unique constraint — a
 * constraint is the follow-up; `assertUniquePlanningName` is the best-effort
 * pre-check that catches the non-racing common case.)
 */
export async function insertAndReadPlanningRow<T>(
  adapter: AkbAdapter,
  vault: string,
  table: ReefTableName,
  fields: Array<[string, string]>,
  toItem: (row: Record<string, unknown>) => T,
): Promise<T> {
  const columns = fields
    .map(([c]) => c)
    .map(quoteIdent)
    .join(", ");
  const values = fields.map(([, v]) => v).join(", ");
  const res = await runSql(
    adapter,
    vault,
    `WITH ins AS (INSERT INTO ${tableRef(table)} (${columns}) VALUES (${values}) RETURNING *) SELECT * FROM ins`,
  );
  const row = res.kind === "table_query" ? res.items[0] : undefined;
  if (!row) {
    throw new SchemaValidationError({
      issues: [`planning row not returned after insert into ${table}`],
    });
  }
  return toItem(row);
}

export async function claimAndReadPlanningRow<T>(input: {
  adapter: AkbAdapter;
  vault: string;
  table: ReefTableName;
  fields: Array<[string, string]>;
  name: string;
  idempotencyKey?: string;
  idempotencyMetaKey: string;
  toItem: (row: Record<string, unknown>) => T;
}): Promise<T> {
  const columns = input.fields.map(([column]) => quoteIdent(column)).join(", ");
  const values = input.fields.map(([, value]) => value).join(", ");
  const idempotencyLock = input.idempotencyKey
    ? `reef:planning:idempotency:${input.idempotencyKey}`
    : null;
  const nameLock = `reef:planning:name:${input.table}:${input.name.trim().toLowerCase()}`;
  const lockValues = [idempotencyLock, nameLock]
    .filter((value): value is string => value !== null)
    .map((value) => `(${quoteText(value, "planning lock")})`)
    .join(", ");
  const existingClaimPredicate = input.idempotencyKey
    ? `planning.meta->>${quoteText(
        input.idempotencyMetaKey,
        "planning claim field",
      )} = ${quoteText(input.idempotencyKey, "planning idempotency key")}`
    : "FALSE";
  const statement = `WITH claim_lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext(lock_key)) FROM (VALUES ${lockValues}) AS locks(lock_key) ORDER BY lock_key), lock_barrier AS MATERIALIZED (SELECT count(*) FROM claim_lock), existing_claim AS MATERIALIZED (SELECT planning.* FROM ${tableRef(
    input.table,
  )} planning CROSS JOIN lock_barrier WHERE ${existingClaimPredicate}), name_conflict AS MATERIALIZED (SELECT 1 FROM ${tableRef(
    input.table,
  )} planning CROSS JOIN lock_barrier WHERE lower(planning.name) = lower(${quoteText(
    input.name,
    "planning name",
  )}) AND NOT EXISTS (SELECT 1 FROM existing_claim) LIMIT 1), ins AS (INSERT INTO ${tableRef(
    input.table,
  )} (${columns}) SELECT ${values} FROM lock_barrier WHERE NOT EXISTS (SELECT 1 FROM existing_claim) AND NOT EXISTS (SELECT 1 FROM name_conflict) RETURNING *), resolved AS (SELECT * FROM existing_claim UNION ALL SELECT * FROM ins) SELECT * FROM resolved`;
  const res = await runSql(input.adapter, input.vault, statement);
  const rows = res.kind === "table_query" ? res.items : [];
  if (rows.length > 1) {
    throw new SchemaValidationError({
      issues: ["planning idempotency claim is ambiguous"],
    });
  }
  const row = rows[0];
  if (!row) throw new ConflictError();
  return input.toItem(row);
}

export async function updatePlanningRow(
  adapter: AkbAdapter,
  vault: string,
  table: ReefTableName,
  id: string,
  fields: Array<[string, string]>,
): Promise<void> {
  const existing = await selectPlanningRows(
    adapter,
    vault,
    table,
    `id = ${quoteText(id, "planning id")}`,
  );
  if (existing.length === 0) {
    throw new NotFoundError({ resource: `planning item ${id}` });
  }
  await runSql(
    adapter,
    vault,
    `UPDATE ${tableRef(table)} SET ${buildRowAssignments(fields)} WHERE id = ${quoteText(
      id,
      "planning id",
    )}`,
  );
}

export async function assertPlanningItemNotReferenced(
  adapter: AkbAdapter,
  vault: string,
  column: "sprint_id" | "milestone_id" | "release_id",
  id: string,
): Promise<void> {
  const rows = await selectIssueRows(
    adapter,
    vault,
    `${quoteIdent(column)} = ${quoteText(id, "planning id")}`,
  );
  if (rows.length > 0) {
    throw new ConflictError();
  }
}

export async function deletePlanningRow(
  adapter: AkbAdapter,
  vault: string,
  table: ReefTableName,
  id: string,
): Promise<void> {
  await runSql(
    adapter,
    vault,
    `DELETE FROM ${tableRef(table)} WHERE id = ${quoteText(id, "planning id")}`,
  );
}
