import { ZodError } from "zod";
import { NotFoundError, SchemaValidationError } from "../../../errors";
import {
  type AgentRunAttempt,
  AgentRunAttemptSchema,
  type AgentRunEventRecord,
  AgentRunEventRecordSchema,
  type AgentRunRecord,
  AgentRunRecordSchema,
  type AgentRunWithIssueStatus,
  AgentRunWithIssueStatusSchema,
  type WorkEvent,
  WorkEventSchema,
} from "../../../schemas/ai/runRecords";
import {
  REEF_AGENT_RUNS_TABLE,
  REEF_AGENT_RUN_ATTEMPTS_TABLE,
  REEF_AGENT_RUN_EVENTS_TABLE,
  REEF_ISSUES_TABLE,
  REEF_WORK_EVENTS_TABLE,
} from "../core/constants";
import type { AkbAdapter } from "../core/http";
import {
  decodeSettingsValue,
  quoteIdent,
  quoteIntOrNull,
  quoteJson,
  quoteText,
  quoteTextOrNull,
  runSql,
  tableRef,
} from "../core/sql";
import { ensureReefTables } from "../core/tables";
import { withSpan } from "../core/tracing";
import type {
  AppendAgentRunEventParams,
  AppendWorkEventParams,
  ListAgentRunAttemptsParams,
  ListAgentRunAttemptsResult,
  ListAgentRunEventsParams,
  ListAgentRunEventsResult,
  ReadAgentRunAttemptParams,
  ReadAgentRunAttemptResult,
  ReadAgentRunParams,
  ReadAgentRunResult,
  ReadAgentRunWithIssueStatusParams,
  ReadAgentRunWithIssueStatusResult,
  WriteAgentRunAttemptParams,
  WriteAgentRunParams,
} from "../core/types";

type Jsonish = Record<string, unknown> | null;

function parseSchemaError(
  err: unknown,
  fallback: string,
): SchemaValidationError {
  if (err instanceof ZodError) {
    return new SchemaValidationError({
      issues: err.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      ),
    });
  }
  return new SchemaValidationError({ issues: [fallback] });
}

function decodeJsonObject(raw: unknown, fallback: Jsonish = {}): Jsonish {
  if (raw == null) return fallback;
  const decoded = decodeSettingsValue(raw);
  if (decoded == null) return fallback;
  if (typeof decoded === "object" && !Array.isArray(decoded)) {
    return decoded as Jsonish;
  }
  return fallback;
}

function quoteJsonOrNull(value: unknown): string {
  return value == null ? "NULL" : quoteJson(value);
}

function rowFields(fields: Array<[string, string]>): {
  columns: string;
  values: string;
} {
  return {
    columns: fields.map(([column]) => quoteIdent(column)).join(", "),
    values: fields.map(([, value]) => value).join(", "),
  };
}

function assignmentList(fields: Array<[string, string]>): string {
  return fields
    .map(([column, value]) => `${quoteIdent(column)} = ${value}`)
    .join(", ");
}

function selectRows(
  adapter: AkbAdapter,
  vault: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  return runSql(adapter, vault, sql).then((res) =>
    res.kind === "table_query" ? res.items : [],
  );
}

export function rowToWorkEvent(row: Record<string, unknown>): WorkEvent {
  try {
    return WorkEventSchema.parse({
      work_event_id: row.work_event_id,
      reef_id: row.reef_id,
      event_type: row.event_type,
      event_key: row.event_key,
      occurred_at: row.occurred_at,
      payload: decodeJsonObject(row.payload),
      meta: decodeJsonObject(row.meta),
    });
  } catch (err) {
    throw parseSchemaError(err, "Work event row validation failed");
  }
}

export function rowToAgentRunRecord(
  row: Record<string, unknown>,
): AgentRunRecord {
  try {
    return AgentRunRecordSchema.parse({
      run_id: row.run_id,
      reef_id: row.reef_id,
      work_event_id: row.work_event_id ?? null,
      task_id: row.task_id,
      vault: row.vault ?? null,
      status: row.status,
      phase: row.phase,
      attempt_number: Number(row.attempt_number),
      target: decodeJsonObject(row.target, null),
      input: decodeJsonObject(row.input),
      result: decodeJsonObject(row.result, null),
      error: decodeJsonObject(row.error, null),
      queued_at: row.queued_at,
      claimed_at: row.claimed_at ?? null,
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      state_updated_at: row.state_updated_at ?? null,
      meta: decodeJsonObject(row.meta),
    });
  } catch (err) {
    throw parseSchemaError(err, "Agent run row validation failed");
  }
}

export function rowToAgentRunWithIssueStatus(
  row: Record<string, unknown>,
): AgentRunWithIssueStatus {
  try {
    return AgentRunWithIssueStatusSchema.parse({
      run: rowToAgentRunRecord(row),
      issue_status: row.issue_status ?? null,
    });
  } catch (err) {
    throw parseSchemaError(
      err,
      "Agent run with issue status row validation failed",
    );
  }
}

export function rowToAgentRunAttempt(
  row: Record<string, unknown>,
): AgentRunAttempt {
  try {
    return AgentRunAttemptSchema.parse({
      attempt_id: row.attempt_id,
      run_id: row.run_id,
      attempt_number: Number(row.attempt_number),
      status: row.status,
      phase: row.phase,
      target: decodeJsonObject(row.target, null),
      started_at: row.started_at,
      completed_at: row.completed_at ?? null,
      result: decodeJsonObject(row.result, null),
      error: decodeJsonObject(row.error, null),
      meta: decodeJsonObject(row.meta),
    });
  } catch (err) {
    throw parseSchemaError(err, "Agent run attempt row validation failed");
  }
}

export function rowToAgentRunEventRecord(
  row: Record<string, unknown>,
): AgentRunEventRecord {
  try {
    return AgentRunEventRecordSchema.parse({
      run_event_id: row.run_event_id,
      run_id: row.run_id,
      attempt_id: row.attempt_id ?? null,
      seq: Number(row.seq),
      event_type: row.event_type,
      phase: row.phase ?? null,
      emitted_at: row.emitted_at,
      payload: decodeJsonObject(row.payload),
      meta: decodeJsonObject(row.meta),
    });
  } catch (err) {
    throw parseSchemaError(err, "Agent run event row validation failed");
  }
}

function workEventFields(event: WorkEvent): Array<[string, string]> {
  return [
    ["work_event_id", quoteText(event.work_event_id, "work event id")],
    ["reef_id", quoteText(event.reef_id, "work event reef_id")],
    ["event_type", quoteText(event.event_type, "work event type")],
    ["event_key", quoteText(event.event_key, "work event key")],
    ["occurred_at", quoteText(event.occurred_at, "work event occurred_at")],
    ["payload", quoteJson(event.payload)],
    ["meta", quoteJson(event.meta)],
  ];
}

function agentRunFields(run: AgentRunRecord): Array<[string, string]> {
  return [
    ["run_id", quoteText(run.run_id, "agent run id")],
    ["reef_id", quoteText(run.reef_id, "agent run reef_id")],
    [
      "work_event_id",
      quoteTextOrNull(run.work_event_id, "agent run work_event_id"),
    ],
    ["task_id", quoteText(run.task_id, "agent run task_id")],
    ["vault", quoteTextOrNull(run.vault, "agent run vault")],
    ["status", quoteText(run.status, "agent run status")],
    ["phase", quoteText(run.phase, "agent run phase")],
    ["attempt_number", quoteIntOrNull(run.attempt_number)],
    ["target", quoteJsonOrNull(run.target)],
    ["input", quoteJson(run.input)],
    ["result", quoteJsonOrNull(run.result)],
    ["error", quoteJsonOrNull(run.error)],
    ["queued_at", quoteText(run.queued_at, "agent run queued_at")],
    ["claimed_at", quoteTextOrNull(run.claimed_at, "agent run claimed_at")],
    ["started_at", quoteTextOrNull(run.started_at, "agent run started_at")],
    [
      "completed_at",
      quoteTextOrNull(run.completed_at, "agent run completed_at"),
    ],
    [
      "state_updated_at",
      quoteTextOrNull(run.state_updated_at, "agent run state_updated_at"),
    ],
    ["meta", quoteJson(run.meta)],
  ];
}

function agentRunAttemptFields(
  attempt: AgentRunAttempt,
): Array<[string, string]> {
  return [
    ["attempt_id", quoteText(attempt.attempt_id, "agent run attempt id")],
    ["run_id", quoteText(attempt.run_id, "agent run attempt run_id")],
    ["attempt_number", quoteIntOrNull(attempt.attempt_number)],
    ["status", quoteText(attempt.status, "agent run attempt status")],
    ["phase", quoteText(attempt.phase, "agent run attempt phase")],
    ["target", quoteJsonOrNull(attempt.target)],
    [
      "started_at",
      quoteText(attempt.started_at, "agent run attempt started_at"),
    ],
    [
      "completed_at",
      quoteTextOrNull(attempt.completed_at, "agent run attempt completed_at"),
    ],
    ["result", quoteJsonOrNull(attempt.result)],
    ["error", quoteJsonOrNull(attempt.error)],
    ["meta", quoteJson(attempt.meta)],
  ];
}

function agentRunEventFields(
  event: AgentRunEventRecord,
): Array<[string, string]> {
  return [
    ["run_event_id", quoteText(event.run_event_id, "agent run event id")],
    ["run_id", quoteText(event.run_id, "agent run event run_id")],
    [
      "attempt_id",
      quoteTextOrNull(event.attempt_id, "agent run event attempt_id"),
    ],
    ["seq", quoteIntOrNull(event.seq)],
    ["event_type", quoteText(event.event_type, "agent run event type")],
    ["phase", quoteTextOrNull(event.phase, "agent run event phase")],
    ["emitted_at", quoteText(event.emitted_at, "agent run event emitted_at")],
    ["payload", quoteJson(event.payload)],
    ["meta", quoteJson(event.meta)],
  ];
}

export async function appendWorkEvent(
  params: AppendWorkEventParams,
): Promise<void> {
  const { adapter, vault } = params;
  const event = WorkEventSchema.parse(params.event);
  return withSpan(
    "akb.append_work_event",
    { vault, reef_id: event.reef_id, event_type: event.event_type },
    async () => {
      await ensureReefTables({ adapter, vault });
      const fields = workEventFields(event);
      const { columns, values } = rowFields(fields);
      const eventKey = quoteText(event.event_key, "work event key");
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(
          REEF_WORK_EVENTS_TABLE,
        )} (${columns}) SELECT ${values} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(
          REEF_WORK_EVENTS_TABLE,
        )} WHERE reef_id = ${quoteText(
          event.reef_id,
          "work event reef_id",
        )} AND event_key = ${eventKey})`,
      );
    },
  );
}

export async function writeAgentRun(
  params: WriteAgentRunParams,
): Promise<void> {
  const { adapter, vault } = params;
  const run = AgentRunRecordSchema.parse(params.run);
  return withSpan(
    "akb.write_agent_run",
    { vault, run_id: run.run_id, reef_id: run.reef_id, status: run.status },
    async () => {
      await ensureReefTables({ adapter, vault });
      const runId = quoteText(run.run_id, "agent run id");
      await runSql(
        adapter,
        vault,
        `DELETE FROM ${tableRef(REEF_AGENT_RUNS_TABLE)} WHERE run_id = ${runId}`,
      );
      const { columns, values } = rowFields(agentRunFields(run));
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(REEF_AGENT_RUNS_TABLE)} (${columns}) VALUES (${values})`,
      );
    },
  );
}

export async function readAgentRun(
  params: ReadAgentRunParams,
): Promise<ReadAgentRunResult> {
  const { adapter, vault, runId } = params;
  return withSpan("akb.read_agent_run", { vault, run_id: runId }, async () => {
    await ensureReefTables({ adapter, vault });
    const rows = await selectRows(
      adapter,
      vault,
      `SELECT * FROM ${tableRef(REEF_AGENT_RUNS_TABLE)} WHERE run_id = ${quoteText(
        runId,
        "agent run id",
      )} LIMIT 1`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundError({ resource: `agent run ${runId}` });
    return { run: rowToAgentRunRecord(row) };
  });
}

export async function readAgentRunWithIssueStatus(
  params: ReadAgentRunWithIssueStatusParams,
): Promise<ReadAgentRunWithIssueStatusResult> {
  const { adapter, vault, runId } = params;
  return withSpan(
    "akb.read_agent_run_with_issue_status",
    { vault, run_id: runId },
    async () => {
      await ensureReefTables({ adapter, vault });
      const rows = await selectRows(
        adapter,
        vault,
        `SELECT r.*, i.status AS issue_status FROM ${tableRef(
          REEF_AGENT_RUNS_TABLE,
        )} r LEFT JOIN ${tableRef(
          REEF_ISSUES_TABLE,
        )} i ON i.reef_id = r.reef_id WHERE r.run_id = ${quoteText(
          runId,
          "agent run id",
        )} LIMIT 1`,
      );
      const row = rows[0];
      if (!row) throw new NotFoundError({ resource: `agent run ${runId}` });
      return { item: rowToAgentRunWithIssueStatus(row) };
    },
  );
}

export async function writeAgentRunAttempt(
  params: WriteAgentRunAttemptParams,
): Promise<void> {
  const { adapter, vault } = params;
  const attempt = AgentRunAttemptSchema.parse(params.attempt);
  return withSpan(
    "akb.write_agent_run_attempt",
    { vault, run_id: attempt.run_id, attempt_id: attempt.attempt_id },
    async () => {
      await ensureReefTables({ adapter, vault });
      const attemptId = quoteText(attempt.attempt_id, "agent run attempt id");
      await runSql(
        adapter,
        vault,
        `DELETE FROM ${tableRef(
          REEF_AGENT_RUN_ATTEMPTS_TABLE,
        )} WHERE attempt_id = ${attemptId}`,
      );
      const { columns, values } = rowFields(agentRunAttemptFields(attempt));
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(
          REEF_AGENT_RUN_ATTEMPTS_TABLE,
        )} (${columns}) VALUES (${values})`,
      );
    },
  );
}

export async function readAgentRunAttempt(
  params: ReadAgentRunAttemptParams,
): Promise<ReadAgentRunAttemptResult> {
  const { adapter, vault, attemptId } = params;
  return withSpan(
    "akb.read_agent_run_attempt",
    { vault, attempt_id: attemptId },
    async () => {
      await ensureReefTables({ adapter, vault });
      const rows = await selectRows(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(
          REEF_AGENT_RUN_ATTEMPTS_TABLE,
        )} WHERE attempt_id = ${quoteText(
          attemptId,
          "agent run attempt id",
        )} LIMIT 1`,
      );
      const row = rows[0];
      if (!row) {
        throw new NotFoundError({
          resource: `agent run attempt ${attemptId}`,
        });
      }
      return { attempt: rowToAgentRunAttempt(row) };
    },
  );
}

export async function listAgentRunAttempts(
  params: ListAgentRunAttemptsParams,
): Promise<ListAgentRunAttemptsResult> {
  const { adapter, vault, runId } = params;
  return withSpan(
    "akb.list_agent_run_attempts",
    { vault, run_id: runId },
    async () => {
      await ensureReefTables({ adapter, vault });
      const rows = await selectRows(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(
          REEF_AGENT_RUN_ATTEMPTS_TABLE,
        )} WHERE run_id = ${quoteText(
          runId,
          "agent run id",
        )} ORDER BY attempt_number ASC`,
      );
      return { attempts: rows.map(rowToAgentRunAttempt) };
    },
  );
}

export async function appendAgentRunEvent(
  params: AppendAgentRunEventParams,
): Promise<void> {
  const { adapter, vault } = params;
  const event = AgentRunEventRecordSchema.parse(params.event);
  return withSpan(
    "akb.append_agent_run_event",
    { vault, run_id: event.run_id, event_type: event.event_type },
    async () => {
      await ensureReefTables({ adapter, vault });
      const fields = agentRunEventFields(event);
      const { columns, values } = rowFields(fields);
      const eventId = quoteText(event.run_event_id, "agent run event id");
      await runSql(
        adapter,
        vault,
        `INSERT INTO ${tableRef(
          REEF_AGENT_RUN_EVENTS_TABLE,
        )} (${columns}) SELECT ${values} WHERE NOT EXISTS (SELECT 1 FROM ${tableRef(
          REEF_AGENT_RUN_EVENTS_TABLE,
        )} WHERE run_event_id = ${eventId})`,
      );
    },
  );
}

export async function listAgentRunEvents(
  params: ListAgentRunEventsParams,
): Promise<ListAgentRunEventsResult> {
  const { adapter, vault, runId } = params;
  return withSpan(
    "akb.list_agent_run_events",
    { vault, run_id: runId },
    async () => {
      await ensureReefTables({ adapter, vault });
      const rows = await selectRows(
        adapter,
        vault,
        `SELECT * FROM ${tableRef(
          REEF_AGENT_RUN_EVENTS_TABLE,
        )} WHERE run_id = ${quoteText(
          runId,
          "agent run id",
        )} ORDER BY seq ASC, emitted_at ASC`,
      );
      return { events: rows.map(rowToAgentRunEventRecord) };
    },
  );
}
