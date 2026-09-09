import { z } from "zod";

export const SprintStatusEnum = z.enum(["planned", "active", "closed"]);
export const MilestoneStatusEnum = z.enum(["open", "closed"]);
export const ReleaseStatusEnum = z.enum(["planned", "in_progress", "released"]);

const optionalDateText = z.string().nullable().optional();

const refineSprintDates = (
  sprint: { start_date?: string | null; end_date?: string | null },
  ctx: z.RefinementCtx,
): void => {
  if (!sprint.start_date || !sprint.end_date) return;
  if (Date.parse(sprint.start_date) > Date.parse(sprint.end_date)) {
    ctx.addIssue({
      code: "custom",
      path: ["end_date"],
      message: "end_date must be on or after start_date",
    });
  }
};

const SprintObject = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: SprintStatusEnum,
  start_date: optionalDateText,
  end_date: optionalDateText,
  goal: z.string().default(""),
  capacity_points: z.number().nonnegative().nullable().optional(),
});

export const SprintSchema = SprintObject.superRefine(refineSprintDates);
// Create input — akb assigns the uuid `id`, so it is omitted. The other fields
// are validated HERE (before the insert), not just on read-back, so an invalid
// status or date range can not persist a row.
export const SprintCreateSchema = SprintObject.omit({ id: true }).superRefine(
  refineSprintDates,
);

export const MilestoneSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: MilestoneStatusEnum,
  target_date: optionalDateText,
  description: z.string().default(""),
});
export const MilestoneCreateSchema = MilestoneSchema.omit({ id: true });

export const ReleaseSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: ReleaseStatusEnum,
  target_date: optionalDateText,
  released_at: optionalDateText,
  notes: z.string().default(""),
});
export const ReleaseCreateSchema = ReleaseSchema.omit({ id: true });

/** Target selection for an explicit sprint rollover confirmation. */
export const SprintRolloverTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing"),
    id: z.uuid(),
  }),
  z.object({
    kind: z.literal("new"),
    item: SprintCreateSchema,
  }),
]);

export const SprintRolloverIssueDispositionEnum = z.enum([
  "pending",
  "moved",
  "skipped",
  "failed",
  "conflict",
]);

export const SprintRolloverIssueActivityEnum = z.enum([
  "recorded",
  "pending",
  "not_required",
]);

export const SprintRolloverIssueResultSchema = z.object({
  id: z.string().min(1),
  disposition: SprintRolloverIssueDispositionEnum,
  activity: SprintRolloverIssueActivityEnum,
  reason: z.string().optional(),
  status: z.string().optional(),
  sprint_id: z.string().nullable().optional(),
});

export const SprintRolloverPhaseStatusEnum = z.enum([
  "not_started",
  "completed",
  "partial",
  "failed",
]);

export const SprintRolloverPhasesSchema = z.object({
  target_preparation: SprintRolloverPhaseStatusEnum,
  source_close: SprintRolloverPhaseStatusEnum,
  target_activation: SprintRolloverPhaseStatusEnum,
  issue_rollover: SprintRolloverPhaseStatusEnum,
});

export const SprintRolloverCountsSchema = z.object({
  eligible: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  backlog: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
  moved: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
});

/** Result returned by the staged close-and-rollover operation. */
export const SprintRolloverResultSchema = z.object({
  status: z.enum(["completed", "partial", "blocked", "noop"]),
  source_sprint: SprintSchema,
  target_sprint: SprintSchema.nullable(),
  source_sprint_id: z.string().min(1),
  target_sprint_id: z.string().nullable(),
  phases: SprintRolloverPhasesSchema,
  counts: SprintRolloverCountsSchema,
  issue_results: z.array(SprintRolloverIssueResultSchema),
  phase_errors: z.array(
    z.object({
      phase: z.enum([
        "target_preparation",
        "source_close",
        "target_activation",
        "issue_rollover",
      ]),
      reason: z.string().min(1),
    }),
  ),
  retryable: z.boolean(),
  no_op: z.boolean(),
});

/** Read-only durable state needed to resume an interrupted rollover. */
export const SprintRolloverResumeSchema = z.object({
  result: SprintRolloverResultSchema,
  target: SprintRolloverTargetSchema,
  end_date: z.string().min(1),
});

export const PlanningCatalogSchema = z.object({
  sprints: z.array(SprintSchema),
  milestones: z.array(MilestoneSchema),
  releases: z.array(ReleaseSchema),
  rollover_resumes: z.array(SprintRolloverResumeSchema),
});

export type Sprint = z.infer<typeof SprintSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type PlanningCatalog = z.infer<typeof PlanningCatalogSchema>;
export type SprintRolloverTarget = z.infer<typeof SprintRolloverTargetSchema>;
export type SprintRolloverIssueDisposition = z.infer<
  typeof SprintRolloverIssueDispositionEnum
>;
export type SprintRolloverIssueActivity = z.infer<
  typeof SprintRolloverIssueActivityEnum
>;
export type SprintRolloverIssueResult = z.infer<
  typeof SprintRolloverIssueResultSchema
>;
export type SprintRolloverPhaseStatus = z.infer<
  typeof SprintRolloverPhaseStatusEnum
>;
export type SprintRolloverPhases = z.infer<typeof SprintRolloverPhasesSchema>;
export type SprintRolloverCounts = z.infer<typeof SprintRolloverCountsSchema>;
export type SprintRolloverResult = z.infer<typeof SprintRolloverResultSchema>;
export type SprintRolloverResume = z.infer<typeof SprintRolloverResumeSchema>;
