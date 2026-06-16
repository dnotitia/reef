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
      code: z.ZodIssueCode.custom,
      path: ["end_date"],
      message: "end_date must be on or after start_date",
    });
  }
};

const SprintObject = z.object({
  id: z.string().uuid(),
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
  id: z.string().uuid(),
  name: z.string().min(1),
  status: MilestoneStatusEnum,
  target_date: optionalDateText,
  description: z.string().default(""),
});
export const MilestoneCreateSchema = MilestoneSchema.omit({ id: true });

export const ReleaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  status: ReleaseStatusEnum,
  target_date: optionalDateText,
  released_at: optionalDateText,
  notes: z.string().default(""),
});
export const ReleaseCreateSchema = ReleaseSchema.omit({ id: true });

export const PlanningCatalogSchema = z.object({
  sprints: z.array(SprintSchema),
  milestones: z.array(MilestoneSchema),
  releases: z.array(ReleaseSchema),
});

export type Sprint = z.infer<typeof SprintSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
export type Release = z.infer<typeof ReleaseSchema>;
export type PlanningCatalog = z.infer<typeof PlanningCatalogSchema>;
