import { z } from "zod";
import { IssueListItemSchema } from "./metadata";
import { VaultNameSchema } from "../workspace/config";

export const MyWorkQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().nonnegative().default(0),
});

export const MyWorkIssueSchema = z.object({
  workspace: VaultNameSchema,
  issue: IssueListItemSchema,
});

export const MyWorkResolvedSprintCountSchema = z.object({
  sprint_id: z.string().min(1),
  count: z.number().int().nonnegative(),
});

export const MyWorkWorkspaceSchema = z.object({
  workspace: VaultNameSchema,
  assigned_issue_count: z.number().int().nonnegative(),
  resolved_sprint_counts: z.array(MyWorkResolvedSprintCountSchema),
});

export const MyWorkResponseSchema = z.object({
  workspaces: z.array(MyWorkWorkspaceSchema),
  issues: z.array(MyWorkIssueSchema),
  next_offset: z.number().int().nonnegative().nullable(),
  as_of: z.string().datetime({ offset: true }),
});

export type MyWorkQuery = z.infer<typeof MyWorkQuerySchema>;
export type MyWorkIssue = z.infer<typeof MyWorkIssueSchema>;
export type MyWorkResolvedSprintCount = z.infer<
  typeof MyWorkResolvedSprintCountSchema
>;
export type MyWorkWorkspace = z.infer<typeof MyWorkWorkspaceSchema>;
export type MyWorkResponse = z.infer<typeof MyWorkResponseSchema>;
