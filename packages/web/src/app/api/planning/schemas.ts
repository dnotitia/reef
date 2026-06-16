import { VaultNameSchema } from "@/lib/api/requestHelpers";
import {
  MilestoneSchema,
  MilestoneStatusEnum,
  ReleaseSchema,
  ReleaseStatusEnum,
  SprintSchema,
  SprintStatusEnum,
} from "@reef/core";
import { z } from "zod";

const optionalDateText = z.string().nullable().optional();

export const SprintInputSchema = z
  .object({
    name: z.string().min(1),
    status: SprintStatusEnum,
    start_date: optionalDateText,
    end_date: optionalDateText,
    goal: z.string().default(""),
    capacity_points: z.number().nonnegative().nullable().optional(),
  })
  .strict()
  .superRefine((sprint, ctx) => {
    if (!sprint.start_date || !sprint.end_date) return;
    if (Date.parse(sprint.start_date) > Date.parse(sprint.end_date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end_date"],
        message: "end_date must be on or after start_date",
      });
    }
  });

export const MilestoneInputSchema = z
  .object({
    name: z.string().min(1),
    status: MilestoneStatusEnum,
    target_date: optionalDateText,
    description: z.string().default(""),
  })
  .strict();

export const ReleaseInputSchema = z
  .object({
    name: z.string().min(1),
    status: ReleaseStatusEnum,
    target_date: optionalDateText,
    released_at: optionalDateText,
    notes: z.string().default(""),
  })
  .strict();

export const CreateSprintRequestSchema = z.object({
  vault: VaultNameSchema,
  item: SprintInputSchema,
});

export const UpdateSprintRequestSchema = z.object({
  vault: VaultNameSchema,
  item: SprintSchema,
});

export const CreateMilestoneRequestSchema = z.object({
  vault: VaultNameSchema,
  item: MilestoneInputSchema,
});

export const UpdateMilestoneRequestSchema = z.object({
  vault: VaultNameSchema,
  item: MilestoneSchema.strict(),
});

export const CreateReleaseRequestSchema = z.object({
  vault: VaultNameSchema,
  item: ReleaseInputSchema,
});

export const UpdateReleaseRequestSchema = z.object({
  vault: VaultNameSchema,
  item: ReleaseSchema.strict(),
});
