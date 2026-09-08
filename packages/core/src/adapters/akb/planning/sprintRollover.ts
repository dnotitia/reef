import {
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import { ACTIVITY_EVENT_PLANNING_LINK } from "../../../schemas/issues/activity";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import {
  SprintRolloverCountsSchema,
  SprintRolloverIssueResultSchema,
  SprintRolloverPhasesSchema,
  SprintRolloverResumeSchema,
  SprintRolloverResultSchema,
  SprintRolloverTargetSchema,
  SprintCreateSchema,
  type SprintRolloverCounts,
  type SprintRolloverIssueResult,
  type SprintRolloverResume,
  type SprintRolloverResult,
  type SprintRolloverTarget,
  type Sprint,
} from "../../../schemas/planning/catalog";
import {
  isSprintRolloverCandidate,
  isValidUtcCalendarDate,
  summarizeSprintRolloverIssues,
  toUtcCalendarDate,
} from "../../../models/sprintRollover";
import { z } from "zod";
import {
  type AkbAdapter,
  REEF_SPRINTS_TABLE,
  SqlParameterBuilder,
  decodeSettingsValue,
  ensureReefTables,
  isMissingTableError,
  runSql,
  rowToIssue,
  selectIssueRows,
  tableRef,
  withSpan,
} from "../core/shared";
import type {
  CloseSprintAndRolloverParams,
  CloseSprintAndRolloverResult,
  CreateSprintParams,
  ListSprintRolloverResumesParams,
} from "../core/types";
import {
  appendActivityEvents,
  type ActivityEventInput,
} from "../issues/activity";
import { readIssue, updateIssue } from "../issues/issues";
import { rowToSprint, selectPlanningRows } from "./planningRows";

type StoredRolloverIssueDisposition =
  | "pending"
  | "moved"
  | "skipped"
  | "failed"
  | "conflict";

const StoredRolloverIssueSchema = z.object({
  event_at: z.string().min(1),
  disposition: z.enum(["pending", "moved", "skipped", "failed", "conflict"]),
  activity: z.enum(["recorded", "pending", "not_required"]),
  reason: z.string().optional(),
  status: z.string().optional(),
  sprint_id: z.string().nullable().optional(),
});

const StoredRolloverStateSchema = z.object({
  operation_key: z.string().min(1),
  source_sprint_id: z.string().min(1),
  target_sprint_id: z.string().min(1).nullable(),
  target_mode: z.enum(["existing", "new"]),
  target_name: z.string().min(1),
  target_goal: z.string(),
  target_capacity_points: z.number().nonnegative().nullable(),
  end_date: z.string().min(1),
  target_start_date: z.string().nullable(),
  target_end_date: z.string().nullable(),
  actor: z.string().min(1),
  source: z.string().min(1),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  phases: SprintRolloverPhasesSchema,
  preview_counts: SprintRolloverCountsSchema,
  issue_states: z.record(z.string(), StoredRolloverIssueSchema),
});

type StoredRolloverIssue = z.infer<typeof StoredRolloverIssueSchema>;
type StoredRolloverState = z.infer<typeof StoredRolloverStateSchema>;

class SprintRolloverPhaseError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SprintRolloverPhaseError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredRolloverState(
  row: Record<string, unknown>,
): StoredRolloverState | null {
  const meta = decodeSettingsValue(row.meta);
  if (!isRecord(meta) || meta.sprint_rollover === undefined) return null;
  const parsed = StoredRolloverStateSchema.safeParse(meta.sprint_rollover);
  if (!parsed.success) {
    throw new SchemaValidationError({
      issues: ["sprint rollover state is malformed"],
    });
  }
  return parsed.data;
}

async function readSprintRecord(
  adapter: AkbAdapter,
  vault: string,
  id: string,
): Promise<{
  row: Record<string, unknown>;
  sprint: Sprint;
  rollover: StoredRolloverState | null;
}> {
  const params = new SqlParameterBuilder();
  const rows = await selectPlanningRows(
    adapter,
    vault,
    REEF_SPRINTS_TABLE,
    `id = ${params.add(id, "sprint id")}`,
    params.params,
  );
  const row = rows[0];
  if (!row) throw new NotFoundError({ resource: `planning item ${id}` });
  return {
    row,
    sprint: rowToSprint(row),
    rollover: readStoredRolloverState(row),
  };
}

async function readActiveSprints(
  adapter: AkbAdapter,
  vault: string,
): Promise<Sprint[]> {
  const params = new SqlParameterBuilder();
  const rows = await selectPlanningRows(
    adapter,
    vault,
    REEF_SPRINTS_TABLE,
    `status = ${params.add("active", "active sprint status")}`,
    params.params,
  );
  return rows.map(rowToSprint);
}

async function readSourceIssues(
  adapter: AkbAdapter,
  vault: string,
  sourceSprintId: string,
): Promise<IssueMetadata[]> {
  const params = new SqlParameterBuilder();
  const rows = await selectIssueRows(
    adapter,
    vault,
    `sprint_id = ${params.add(sourceSprintId, "source sprint id")}`,
    undefined,
    undefined,
    params,
  );
  return rows.map(rowToIssue);
}

function normalizedInstant(value: string | undefined): string {
  const candidate = value ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(candidate))) {
    throw new SchemaValidationError({
      issues: ["rollover timestamp must be a valid ISO-8601 instant"],
    });
  }
  return new Date(candidate).toISOString();
}

function requiredCalendarDate(value: unknown, field: string): string {
  const date = toUtcCalendarDate(typeof value === "string" ? value : null);
  if (!date || !isValidUtcCalendarDate(date)) {
    throw new SchemaValidationError({
      issues: [`${field} must be a valid UTC calendar date`],
    });
  }
  return date;
}

function assertSourceEndDate(source: Sprint, endDate: string): string {
  const end = requiredCalendarDate(endDate, "end_date");
  const start = source.start_date
    ? requiredCalendarDate(source.start_date, "source start_date")
    : null;
  if (start && start > end) {
    throw new SchemaValidationError({
      issues: ["end_date must be on or after the source start date"],
    });
  }
  if (source.end_date != null) {
    requiredCalendarDate(source.end_date, "source end_date");
  }
  return end;
}

function normalizeNewSprintItem(
  item: Extract<SprintRolloverTarget, { kind: "new" }>["item"],
): Omit<Sprint, "id"> {
  const validated = SprintCreateSchema.parse(item);
  const name = validated.name.trim();
  if (!name) {
    throw new SchemaValidationError({
      issues: ["target sprint name is required"],
    });
  }
  if (validated.status !== "planned") {
    throw new ConflictError();
  }
  const start = requiredCalendarDate(validated.start_date, "target start_date");
  const end = requiredCalendarDate(validated.end_date, "target end_date");
  if (start > end) {
    throw new SchemaValidationError({
      issues: ["target end_date must be on or after target start_date"],
    });
  }
  return {
    name,
    status: "planned",
    start_date: start,
    end_date: end,
    goal: validated.goal ?? "",
    capacity_points: validated.capacity_points ?? null,
  };
}

function validateExistingTarget(
  sprint: Sprint,
  sourceSprintId: string,
): Sprint {
  if (sprint.id === sourceSprintId || sprint.status !== "planned") {
    throw new ConflictError();
  }
  requiredCalendarDate(sprint.start_date, "target start_date");
  requiredCalendarDate(sprint.end_date, "target end_date");
  return sprint;
}

async function resolveRolloverTargetRequest(
  adapter: AkbAdapter,
  vault: string,
  sourceSprintId: string,
  target: SprintRolloverTarget,
): Promise<{
  sprint: Sprint | null;
  item: Omit<Sprint, "id"> | null;
  mode: "existing" | "new";
}> {
  if (target.kind === "existing") {
    const record = await readSprintRecord(adapter, vault, target.id);
    return {
      sprint: validateExistingTarget(record.sprint, sourceSprintId),
      item: null,
      mode: "existing",
    };
  }
  const item = normalizeNewSprintItem(target.item);
  return { sprint: null, item, mode: "new" };
}

function assertTargetRequestMatchesState(
  target: SprintRolloverTarget,
  state: StoredRolloverState,
): void {
  if (target.kind === "existing") {
    if (
      state.target_mode !== "existing" ||
      target.id !== state.target_sprint_id
    )
      throw new ConflictError();
    return;
  }
  const item = normalizeNewSprintItem(target.item);
  if (
    state.target_mode !== "new" ||
    item.name !== state.target_name ||
    item.start_date !== state.target_start_date ||
    item.end_date !== state.target_end_date ||
    item.goal !== state.target_goal ||
    (item.capacity_points ?? null) !== state.target_capacity_points
  ) {
    throw new ConflictError();
  }
}

function assertRolloverStatesMatch(
  requested: StoredRolloverState,
  claimed: StoredRolloverState,
): void {
  if (
    requested.operation_key !== claimed.operation_key ||
    requested.source_sprint_id !== claimed.source_sprint_id ||
    requested.target_mode !== claimed.target_mode ||
    requested.target_sprint_id !== claimed.target_sprint_id ||
    requested.target_name !== claimed.target_name ||
    requested.target_goal !== claimed.target_goal ||
    requested.target_capacity_points !== claimed.target_capacity_points ||
    requested.end_date !== claimed.end_date ||
    requested.target_start_date !== claimed.target_start_date ||
    requested.target_end_date !== claimed.target_end_date
  ) {
    throw new ConflictError();
  }
}

function assertTargetDatesMatchState(
  target: Sprint,
  state: StoredRolloverState,
): void {
  if (
    toUtcCalendarDate(target.start_date) !== state.target_start_date ||
    toUtcCalendarDate(target.end_date) !== state.target_end_date
  ) {
    throw new ConflictError();
  }
}

function initialRolloverState(input: {
  operationKey: string;
  sourceSprintId: string;
  targetSprint: Sprint | null;
  targetItem: Omit<Sprint, "id"> | null;
  targetMode: "existing" | "new";
  endDate: string;
  actor: string;
  source: string;
  at: string;
  issues: readonly IssueMetadata[];
}): StoredRolloverState {
  const preview = summarizeSprintRolloverIssues(
    input.issues,
    input.sourceSprintId,
  );
  const issueStates: Record<string, StoredRolloverIssue> = {};
  for (const issue of input.issues) {
    if (!isSprintRolloverCandidate(issue, input.sourceSprintId)) continue;
    issueStates[issue.id] = {
      event_at: input.at,
      disposition: "pending",
      activity: "pending",
      status: issue.status,
      sprint_id: issue.sprint_id,
    };
  }
  return {
    operation_key: input.operationKey,
    source_sprint_id: input.sourceSprintId,
    target_sprint_id: input.targetSprint?.id ?? null,
    target_mode: input.targetMode,
    target_name: input.targetSprint?.name ?? input.targetItem?.name ?? "",
    target_goal: input.targetSprint?.goal ?? input.targetItem?.goal ?? "",
    target_capacity_points:
      input.targetSprint?.capacity_points ??
      input.targetItem?.capacity_points ??
      null,
    end_date: input.endDate,
    target_start_date: toUtcCalendarDate(
      input.targetSprint?.start_date ?? input.targetItem?.start_date,
    ),
    target_end_date: toUtcCalendarDate(
      input.targetSprint?.end_date ?? input.targetItem?.end_date,
    ),
    actor: input.actor,
    source: input.source,
    created_at: input.at,
    updated_at: input.at,
    phases: {
      target_preparation: input.targetSprint ? "completed" : "not_started",
      source_close: "not_started",
      target_activation: "not_started",
      issue_rollover: "not_started",
    },
    preview_counts: {
      ...preview,
      moved: 0,
      skipped: 0,
      failed: 0,
      conflicts: 0,
    },
    issue_states: issueStates,
  };
}

function rowsFromSql(response: Awaited<ReturnType<typeof runSql>>) {
  return response.kind === "table_query" ? response.items : [];
}

async function writeRolloverState(
  adapter: AkbAdapter,
  vault: string,
  sourceSprintId: string,
  state: StoredRolloverState,
  expectedOperationKey?: string,
): Promise<Record<string, unknown> | undefined> {
  const params = new SqlParameterBuilder();
  const lockKey = params.add(
    state.operation_key,
    "sprint rollover operation key",
  );
  const stateParam = params.addJson(state, "sprint rollover state", "jsonb");
  const sourceIdParam = params.add(sourceSprintId, "source sprint id");
  const expectedParam = expectedOperationKey
    ? params.add(expectedOperationKey, "expected rollover operation key")
    : null;
  const ownershipPredicate = expectedParam
    ? `meta::jsonb->'sprint_rollover'->>'operation_key' = ${expectedParam}`
    : "meta IS NULL OR meta::jsonb->'sprint_rollover' IS NULL";
  const response = await runSql(
    adapter,
    vault,
    `WITH lock AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))), upd AS (UPDATE ${tableRef(
      REEF_SPRINTS_TABLE,
    )} SET meta = (COALESCE(meta::jsonb, '{}'::jsonb) || jsonb_build_object('sprint_rollover', ${stateParam}))::json FROM lock WHERE id = ${sourceIdParam} AND (${ownershipPredicate}) RETURNING *) SELECT * FROM upd`,
    params.params,
  );
  return rowsFromSql(response)[0];
}

async function claimRolloverState(
  adapter: AkbAdapter,
  vault: string,
  state: StoredRolloverState,
): Promise<StoredRolloverState> {
  const inserted = await writeRolloverState(
    adapter,
    vault,
    state.source_sprint_id,
    state,
  );
  if (inserted)
    return StoredRolloverStateSchema.parse(readStoredRolloverState(inserted));

  const current = await readSprintRecord(
    adapter,
    vault,
    state.source_sprint_id,
  );
  if (
    !current.rollover ||
    current.rollover.operation_key !== state.operation_key
  ) {
    throw new ConflictError();
  }
  assertRolloverStatesMatch(state, current.rollover);
  return current.rollover;
}

async function updateRolloverState(
  adapter: AkbAdapter,
  vault: string,
  sourceSprintId: string,
  operationKey: string,
  update: (state: StoredRolloverState) => StoredRolloverState,
): Promise<StoredRolloverState> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await readSprintRecord(adapter, vault, sourceSprintId);
    if (!current.rollover || current.rollover.operation_key !== operationKey) {
      throw new ConflictError();
    }
    const next = update({
      ...current.rollover,
      phases: { ...current.rollover.phases },
      preview_counts: { ...current.rollover.preview_counts },
      issue_states: { ...current.rollover.issue_states },
      updated_at: new Date().toISOString(),
    });
    const written = await writeRolloverState(
      adapter,
      vault,
      sourceSprintId,
      next,
      operationKey,
    );
    if (written) return next;
  }
  throw new ConflictError();
}

function requiredTargetSprintId(state: StoredRolloverState): string {
  if (!state.target_sprint_id) throw new ConflictError();
  return state.target_sprint_id;
}

async function prepareTargetSprint(
  adapter: AkbAdapter,
  vault: string,
  state: StoredRolloverState,
  createTarget: (params: CreateSprintParams) => Promise<Sprint>,
): Promise<{ state: StoredRolloverState; sprint: Sprint }> {
  if (state.target_sprint_id) {
    const target = await readSprintRecord(
      adapter,
      vault,
      state.target_sprint_id,
    );
    assertTargetDatesMatchState(target.sprint, state);
    return { state, sprint: target.sprint };
  }
  if (state.target_mode !== "new") throw new ConflictError();
  if (!state.target_start_date || !state.target_end_date) {
    throw new SchemaValidationError({
      issues: ["new rollover target dates are missing"],
    });
  }

  const sprint = await createTarget({
    adapter,
    vault,
    item: {
      name: state.target_name,
      status: "planned",
      start_date: state.target_start_date,
      end_date: state.target_end_date,
      goal: state.target_goal,
      capacity_points: state.target_capacity_points,
    },
    idempotencyKey: state.operation_key,
  });
  if (
    sprint.status !== "planned" ||
    sprint.name !== state.target_name ||
    toUtcCalendarDate(sprint.start_date) !== state.target_start_date ||
    toUtcCalendarDate(sprint.end_date) !== state.target_end_date ||
    sprint.goal !== state.target_goal ||
    (sprint.capacity_points ?? null) !== state.target_capacity_points
  ) {
    throw new ConflictError();
  }

  const nextState = await updateRolloverState(
    adapter,
    vault,
    state.source_sprint_id,
    state.operation_key,
    (current) => ({
      ...current,
      target_sprint_id: sprint.id,
      phases: { ...current.phases, target_preparation: "completed" },
    }),
  );
  return { state: nextState, sprint };
}

async function closeSourceSprint(
  adapter: AkbAdapter,
  vault: string,
  source: Sprint,
  state: StoredRolloverState,
): Promise<Sprint> {
  const params = new SqlParameterBuilder();
  const statusParam = params.add("closed", "source sprint status");
  const endParam = params.add(state.end_date, "source sprint end_date");
  const stateParam = params.addJson(
    {
      ...state,
      phases: { ...state.phases, source_close: "completed" },
    },
    "sprint rollover state",
    "jsonb",
  );
  const sourceIdParam = params.add(source.id, "source sprint id");
  const operationParam = params.add(
    state.operation_key,
    "expected rollover operation key",
  );
  const response = await runSql(
    adapter,
    vault,
    `WITH upd AS (UPDATE ${tableRef(
      REEF_SPRINTS_TABLE,
    )} SET status = ${statusParam}, end_date = ${endParam}, meta = (COALESCE(meta::jsonb, '{}'::jsonb) || jsonb_build_object('sprint_rollover', ${stateParam}))::json WHERE id = ${sourceIdParam} AND status = 'active' AND meta::jsonb->'sprint_rollover'->>'operation_key' = ${operationParam} RETURNING *) SELECT * FROM upd`,
    params.params,
  );
  const row = rowsFromSql(response)[0];
  if (row) return rowToSprint(row);

  const current = await readSprintRecord(adapter, vault, source.id);
  const currentEnd = toUtcCalendarDate(current.sprint.end_date);
  if (current.sprint.status === "closed" && currentEnd === state.end_date) {
    return current.sprint;
  }
  throw new SprintRolloverPhaseError("source_close_failed");
}

async function activateTargetSprint(
  adapter: AkbAdapter,
  vault: string,
  sourceSprintId: string,
  state: StoredRolloverState,
): Promise<Sprint> {
  const targetSprintId = requiredTargetSprintId(state);
  const target = await readSprintRecord(adapter, vault, targetSprintId);
  assertTargetDatesMatchState(target.sprint, state);
  if (target.sprint.status === "active") return target.sprint;
  if (target.sprint.status !== "planned") {
    throw new ConflictError();
  }

  const active = await readActiveSprints(adapter, vault);
  if (active.some((sprint) => sprint.id !== targetSprintId)) {
    throw new SprintRolloverPhaseError("other_active_sprint");
  }

  const params = new SqlParameterBuilder();
  const stateParam = params.addJson(
    {
      sprint_rollover_source_sprint_id: sourceSprintId,
      sprint_rollover_operation_key: state.operation_key,
    },
    "target sprint rollover metadata",
    "jsonb",
  );
  const targetIdParam = params.add(targetSprintId, "target sprint id");
  const response = await runSql(
    adapter,
    vault,
    `WITH upd AS (UPDATE ${tableRef(
      REEF_SPRINTS_TABLE,
    )} SET status = 'active', meta = (COALESCE(meta::jsonb, '{}'::jsonb) || ${stateParam})::json WHERE id = ${targetIdParam} AND status = 'planned' RETURNING *) SELECT * FROM upd`,
    params.params,
  );
  const row = rowsFromSql(response)[0];
  if (row) return rowToSprint(row);

  const current = await readSprintRecord(adapter, vault, targetSprintId);
  if (current.sprint.status === "active") return current.sprint;
  throw new SprintRolloverPhaseError("target_activation_failed");
}

function issueOutcomeResult(
  id: string,
  state: StoredRolloverIssue,
): SprintRolloverIssueResult {
  return SprintRolloverIssueResultSchema.parse({
    id,
    disposition: state.disposition,
    activity: state.activity,
    ...(state.reason ? { reason: state.reason } : {}),
    ...(state.status ? { status: state.status } : {}),
    ...(state.sprint_id !== undefined ? { sprint_id: state.sprint_id } : {}),
  });
}

function resultCounts(state: StoredRolloverState): SprintRolloverCounts {
  const counts = { ...state.preview_counts };
  counts.moved = 0;
  counts.skipped = 0;
  counts.failed = 0;
  counts.conflicts = 0;
  for (const issue of Object.values(state.issue_states)) {
    if (issue.disposition === "moved") counts.moved += 1;
    if (issue.disposition === "skipped") counts.skipped += 1;
    if (issue.disposition === "failed") counts.failed += 1;
    if (issue.disposition === "conflict") counts.conflicts += 1;
  }
  return SprintRolloverCountsSchema.parse(counts);
}

function stateIsComplete(state: StoredRolloverState): boolean {
  return (
    state.phases.target_preparation === "completed" &&
    state.phases.source_close === "completed" &&
    state.phases.target_activation === "completed" &&
    state.phases.issue_rollover === "completed" &&
    Object.values(state.issue_states).every(
      (issue) =>
        (issue.disposition === "moved" && issue.activity === "recorded") ||
        issue.disposition === "skipped",
    )
  );
}

function rolloverResult(input: {
  source: Sprint;
  target: Sprint | null;
  state: StoredRolloverState;
  phaseErrors?: Array<{
    phase:
      | "target_preparation"
      | "source_close"
      | "target_activation"
      | "issue_rollover";
    reason: string;
  }>;
  noOp?: boolean;
}): SprintRolloverResult {
  const phaseErrors = input.phaseErrors ?? [];
  const counts = resultCounts(input.state);
  const issueProblem = Object.values(input.state.issue_states).some(
    (issue) =>
      issue.disposition === "pending" ||
      issue.disposition === "failed" ||
      issue.disposition === "conflict",
  );
  const blocked =
    input.state.phases.source_close !== "completed" ||
    input.state.phases.target_activation !== "completed";
  const status =
    phaseErrors.length > 0 || blocked
      ? input.state.phases.source_close === "completed"
        ? "partial"
        : "blocked"
      : issueProblem
        ? "partial"
        : "completed";
  return SprintRolloverResultSchema.parse({
    status,
    source_sprint: input.source,
    target_sprint: input.target,
    source_sprint_id: input.state.source_sprint_id,
    target_sprint_id: input.state.target_sprint_id,
    phases: input.state.phases,
    counts,
    issue_results: Object.entries(input.state.issue_states)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, issue]) => issueOutcomeResult(id, issue)),
    phase_errors: phaseErrors,
    retryable: status !== "completed",
    no_op: input.noOp ?? false,
  });
}

function targetRequestFromState(
  state: StoredRolloverState,
): SprintRolloverTarget {
  if (state.target_mode === "existing") {
    if (!state.target_sprint_id) {
      throw new SchemaValidationError({
        issues: ["existing rollover target id is missing"],
      });
    }
    return { kind: "existing", id: state.target_sprint_id };
  }
  return {
    kind: "new",
    item: {
      name: state.target_name,
      status: "planned",
      start_date: state.target_start_date,
      end_date: state.target_end_date,
      goal: state.target_goal,
      capacity_points: state.target_capacity_points,
    },
  };
}

/** Read incomplete rollover claims without exposing actor or source metadata. */
export async function listSprintRolloverResumes(
  params: ListSprintRolloverResumesParams,
): Promise<SprintRolloverResume[]> {
  const { adapter, vault } = params;
  return withSpan(
    "akb.list_sprint_rollover_resumes",
    { vault },
    async (span) => {
      try {
        const rows = await selectPlanningRows(
          adapter,
          vault,
          REEF_SPRINTS_TABLE,
        );
        const resumes: SprintRolloverResume[] = [];
        for (const row of rows) {
          const state = readStoredRolloverState(row);
          if (!state || stateIsComplete(state)) continue;
          const source = rowToSprint(row);
          const target = state.target_sprint_id
            ? (await readSprintRecord(adapter, vault, state.target_sprint_id))
                .sprint
            : null;
          resumes.push(
            SprintRolloverResumeSchema.parse({
              result: rolloverResult({ source, target, state }),
              target: targetRequestFromState(state),
              end_date: state.end_date,
            }),
          );
        }
        span.setAttribute("resume_count", resumes.length);
        return resumes;
      } catch (error) {
        if (isMissingTableError(error)) {
          span.setAttribute("table_exists", false);
          return [];
        }
        throw error;
      }
    },
  );
}

async function ensureSprintPlanningLink(
  adapter: AkbAdapter,
  vault: string,
  issueId: string,
  sourceSprintId: string,
  targetSprintId: string,
  eventAt: string,
  actor: string,
  source: string,
): Promise<void> {
  const event: ActivityEventInput = {
    reefId: issueId,
    eventType: ACTIVITY_EVENT_PLANNING_LINK,
    payload: {
      field: "sprint",
      from: sourceSprintId,
      to: targetSprintId,
    },
    at: eventAt,
    actor,
    source,
  };
  await appendActivityEvents(adapter, vault, [event]);
}

async function processRolloverIssue(input: {
  adapter: AkbAdapter;
  vault: string;
  issueId: string;
  sourceSprintId: string;
  targetSprintId: string;
  eventAt: string;
  actor: string;
  source: string;
}): Promise<StoredRolloverIssue> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let current: IssueMetadata;
    try {
      current = (
        await readIssue({
          adapter: input.adapter,
          vault: input.vault,
          id: input.issueId,
        })
      ).issue;
    } catch (error) {
      return {
        event_at: input.eventAt,
        disposition: "failed",
        activity: "pending",
        reason:
          error instanceof NotFoundError
            ? "issue_not_found"
            : "issue_read_failed",
      };
    }

    if (current.archived_at != null) {
      return {
        event_at: input.eventAt,
        disposition: "skipped",
        activity: "not_required",
        reason: "archived",
        status: current.status,
        sprint_id: current.sprint_id,
      };
    }
    if (current.sprint_id === input.targetSprintId) {
      try {
        await ensureSprintPlanningLink(
          input.adapter,
          input.vault,
          input.issueId,
          input.sourceSprintId,
          input.targetSprintId,
          input.eventAt,
          input.actor,
          input.source,
        );
        return {
          event_at: input.eventAt,
          disposition: "moved",
          activity: "recorded",
          status: current.status,
          sprint_id: current.sprint_id,
        };
      } catch {
        return {
          event_at: input.eventAt,
          disposition: "failed",
          activity: "pending",
          reason: "activity_pending",
          status: current.status,
          sprint_id: current.sprint_id,
        };
      }
    }
    if (current.sprint_id !== input.sourceSprintId) {
      return {
        event_at: input.eventAt,
        disposition: "conflict",
        activity: "not_required",
        reason: "moved_to_other_sprint",
        status: current.status,
        sprint_id: current.sprint_id,
      };
    }
    if (!isSprintRolloverCandidate(current, input.sourceSprintId)) {
      return {
        event_at: input.eventAt,
        disposition: "skipped",
        activity: "not_required",
        reason: `status_${current.status}`,
        status: current.status,
        sprint_id: current.sprint_id,
      };
    }

    try {
      await updateIssue({
        adapter: input.adapter,
        vault: input.vault,
        id: input.issueId,
        partial: {
          sprint_id: input.targetSprintId,
          updated_at: input.eventAt,
          updated_by: input.actor,
          source: input.source,
        },
        expectedUpdatedAt: current.updated_at,
      });
      try {
        await ensureSprintPlanningLink(
          input.adapter,
          input.vault,
          input.issueId,
          input.sourceSprintId,
          input.targetSprintId,
          input.eventAt,
          input.actor,
          input.source,
        );
        return {
          event_at: input.eventAt,
          disposition: "moved",
          activity: "recorded",
          status: current.status,
          sprint_id: input.targetSprintId,
        };
      } catch {
        return {
          event_at: input.eventAt,
          disposition: "failed",
          activity: "pending",
          reason: "activity_pending",
          status: current.status,
          sprint_id: input.targetSprintId,
        };
      }
    } catch (error) {
      if (error instanceof ConflictError && attempt === 0) continue;
      if (error instanceof ConflictError) {
        return {
          event_at: input.eventAt,
          disposition: "conflict",
          activity: "not_required",
          reason: "row_conflict",
          status: current.status,
          sprint_id: current.sprint_id,
        };
      }
      return {
        event_at: input.eventAt,
        disposition: "failed",
        activity: "pending",
        reason:
          error instanceof ConflictError
            ? "row_conflict"
            : "issue_update_failed",
        status: current.status,
        sprint_id: current.sprint_id,
      };
    }
  }
  return {
    event_at: input.eventAt,
    disposition: "conflict",
    activity: "not_required",
    reason: "row_conflict",
  };
}

async function updateIssueState(
  adapter: AkbAdapter,
  vault: string,
  state: StoredRolloverState,
  issueId: string,
  outcome: StoredRolloverIssue,
): Promise<StoredRolloverState> {
  return updateRolloverState(
    adapter,
    vault,
    state.source_sprint_id,
    state.operation_key,
    (current) => {
      const existing = current.issue_states[issueId];
      if (
        existing &&
        existing.disposition === "moved" &&
        existing.activity === "recorded"
      ) {
        return current;
      }
      return {
        ...current,
        issue_states: { ...current.issue_states, [issueId]: outcome },
      };
    },
  );
}

/**
 * Close an active sprint, activate an explicitly selected/new target, and
 * resume the durable issue carry-forward state after any partial failure.
 */
export async function closeSprintAndRollover(
  params: CloseSprintAndRolloverParams,
  createTarget: (params: CreateSprintParams) => Promise<Sprint>,
): Promise<CloseSprintAndRolloverResult> {
  const { adapter, vault, sourceSprintId, actor, source } = params;
  return withSpan(
    "akb.close_sprint_and_rollover",
    { vault, source_sprint_id: sourceSprintId },
    async (span) => {
      if (!actor.trim() || !source.trim()) {
        throw new SchemaValidationError({
          issues: ["rollover actor and source are required"],
        });
      }
      const targetInput = SprintRolloverTargetSchema.parse(params.target);
      await ensureReefTables({ adapter, vault });

      let sourceRecord = await readSprintRecord(adapter, vault, sourceSprintId);
      const operationKey = `sprint-rollover:${sourceSprintId}`;
      const requestedEndDate = assertSourceEndDate(
        sourceRecord.sprint,
        params.endDate,
      );
      let state = sourceRecord.rollover;
      let target: Sprint | null = null;

      if (state) {
        if (state.operation_key !== operationKey) throw new ConflictError();
        if (state.end_date !== requestedEndDate) throw new ConflictError();
        assertTargetRequestMatchesState(targetInput, state);
        if (state.target_sprint_id) {
          target = (
            await readSprintRecord(adapter, vault, state.target_sprint_id)
          ).sprint;
        }
      } else {
        if (sourceRecord.sprint.status !== "active") {
          throw new ConflictError();
        }
        const active = await readActiveSprints(adapter, vault);
        const conflictingActive = active.find(
          (sprint) => sprint.id !== sourceSprintId,
        );
        if (conflictingActive) {
          throw new ConflictError({
            code: "planning.sprintRollover.activeConflict",
            params: { sprintName: conflictingActive.name },
            path: `planning/sprints/${conflictingActive.id}`,
          });
        }
        const issues = await readSourceIssues(adapter, vault, sourceSprintId);
        const resolved = await resolveRolloverTargetRequest(
          adapter,
          vault,
          sourceSprintId,
          targetInput,
        );
        const initial = initialRolloverState({
          operationKey,
          sourceSprintId,
          targetSprint: resolved.sprint,
          targetItem: resolved.item,
          targetMode: resolved.mode,
          endDate: requestedEndDate,
          actor,
          source,
          at: normalizedInstant(params.now),
          issues,
        });
        state = await claimRolloverState(adapter, vault, initial);
      }

      if (!state) throw new ConflictError();
      sourceRecord = await readSprintRecord(adapter, vault, sourceSprintId);
      try {
        const prepared = await prepareTargetSprint(
          adapter,
          vault,
          state,
          createTarget,
        );
        state = prepared.state;
        target = prepared.sprint;
      } catch (error) {
        if (state.target_sprint_id) throw error;
        state = await updateRolloverState(
          adapter,
          vault,
          sourceSprintId,
          state.operation_key,
          (current) => ({
            ...current,
            phases: { ...current.phases, target_preparation: "failed" },
          }),
        ).catch(() => state as StoredRolloverState);
        sourceRecord = await readSprintRecord(adapter, vault, sourceSprintId);
        return rolloverResult({
          source: sourceRecord.sprint,
          target: null,
          state,
          phaseErrors: [
            {
              phase: "target_preparation",
              reason:
                error instanceof SprintRolloverPhaseError
                  ? error.reason
                  : "target_preparation_failed",
            },
          ],
        });
      }
      if (!target) throw new ConflictError();
      assertTargetDatesMatchState(target, state);

      if (
        stateIsComplete(state) &&
        sourceRecord.sprint.status === "closed" &&
        target.status === "active"
      ) {
        span.setAttribute("no_op", true);
        return rolloverResult({
          source: sourceRecord.sprint,
          target,
          state,
          noOp: true,
        });
      }

      if (sourceRecord.sprint.status === "active") {
        try {
          const closed = await closeSourceSprint(
            adapter,
            vault,
            sourceRecord.sprint,
            state,
          );
          state = await updateRolloverState(
            adapter,
            vault,
            sourceSprintId,
            state.operation_key,
            (current) => ({
              ...current,
              phases: { ...current.phases, source_close: "completed" },
            }),
          );
          sourceRecord = {
            ...(await readSprintRecord(adapter, vault, sourceSprintId)),
            sprint: closed,
          };
        } catch (error) {
          state = await updateRolloverState(
            adapter,
            vault,
            sourceSprintId,
            state.operation_key,
            (current) => ({
              ...current,
              phases: { ...current.phases, source_close: "failed" },
            }),
          ).catch(() => state as StoredRolloverState);
          sourceRecord = await readSprintRecord(adapter, vault, sourceSprintId);
          return rolloverResult({
            source: sourceRecord.sprint,
            target,
            state,
            phaseErrors: [
              {
                phase: "source_close",
                reason:
                  error instanceof SprintRolloverPhaseError
                    ? error.reason
                    : "source_close_failed",
              },
            ],
          });
        }
      } else if (sourceRecord.sprint.status === "closed") {
        if (
          toUtcCalendarDate(sourceRecord.sprint.end_date) !== state.end_date
        ) {
          throw new ConflictError();
        }
        state = await updateRolloverState(
          adapter,
          vault,
          sourceSprintId,
          state.operation_key,
          (current) => ({
            ...current,
            phases: { ...current.phases, source_close: "completed" },
          }),
        );
      } else {
        throw new ConflictError();
      }

      const targetSprintId = requiredTargetSprintId(state);
      target = (await readSprintRecord(adapter, vault, targetSprintId)).sprint;
      if (target.status !== "active") {
        try {
          target = await activateTargetSprint(
            adapter,
            vault,
            sourceSprintId,
            state,
          );
          state = await updateRolloverState(
            adapter,
            vault,
            sourceSprintId,
            state.operation_key,
            (current) => ({
              ...current,
              phases: { ...current.phases, target_activation: "completed" },
            }),
          );
        } catch (error) {
          state = await updateRolloverState(
            adapter,
            vault,
            sourceSprintId,
            state.operation_key,
            (current) => ({
              ...current,
              phases: { ...current.phases, target_activation: "failed" },
            }),
          ).catch(() => state as StoredRolloverState);
          target = (
            await readSprintRecord(
              adapter,
              vault,
              requiredTargetSprintId(state),
            )
          ).sprint;
          return rolloverResult({
            source: sourceRecord.sprint,
            target,
            state,
            phaseErrors: [
              {
                phase: "target_activation",
                reason:
                  error instanceof SprintRolloverPhaseError
                    ? error.reason
                    : "target_activation_failed",
              },
            ],
          });
        }
      } else {
        state = await updateRolloverState(
          adapter,
          vault,
          sourceSprintId,
          state.operation_key,
          (current) => ({
            ...current,
            phases: { ...current.phases, target_activation: "completed" },
          }),
        );
      }

      const issueIds = Object.keys(state.issue_states).sort();
      for (const issueId of issueIds) {
        const stored = state.issue_states[issueId];
        if (
          !stored ||
          stored.disposition === "skipped" ||
          stored.disposition === "conflict"
        ) {
          continue;
        }
        if (stored.disposition === "moved" && stored.activity === "recorded") {
          continue;
        }
        const outcome = await processRolloverIssue({
          adapter,
          vault,
          issueId,
          sourceSprintId,
          targetSprintId,
          eventAt: stored.event_at,
          actor: state.actor,
          source: state.source,
        });
        state = await updateIssueState(adapter, vault, state, issueId, outcome);
      }

      const hasProblem = Object.values(state.issue_states).some(
        (issue) =>
          issue.disposition === "pending" ||
          issue.disposition === "failed" ||
          issue.disposition === "conflict",
      );
      state = await updateRolloverState(
        adapter,
        vault,
        sourceSprintId,
        state.operation_key,
        (current) => ({
          ...current,
          phases: {
            ...current.phases,
            issue_rollover: hasProblem ? "partial" : "completed",
          },
        }),
      );
      sourceRecord = await readSprintRecord(adapter, vault, sourceSprintId);
      target = (await readSprintRecord(adapter, vault, targetSprintId)).sprint;
      span.setAttribute("moved_count", resultCounts(state).moved);
      span.setAttribute("failed_count", resultCounts(state).failed);
      return rolloverResult({
        source: sourceRecord.sprint,
        target,
        state,
      });
    },
  );
}
