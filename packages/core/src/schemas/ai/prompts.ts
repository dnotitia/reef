import { z } from "zod";
import { IssueListItemSchema } from "../issues/metadata";
import {
  EnrichmentContextSchema,
  EnrichmentDraftSchema,
  EnrichmentRepoContextSchema,
} from "./enrichment";

// ─── Shared sub-schemas ──────────────────────────────────────────────────────

const IssueContextSchema = IssueListItemSchema.pick({
  id: true,
  title: true,
  status: true,
  issue_type: true,
  assigned_to: true,
  requester: true,
  reporter: true,
  start_date: true,
  due_date: true,
  milestone_id: true,
  sprint_id: true,
  release_id: true,
  severity: true,
  parent_id: true,
  labels: true,
  depends_on: true,
  blocks: true,
  related_to: true,
});

const MonitoredRepoInfoSchema = z.object({
  owner: z.string(),
  name: z.string(),
  defaultBranch: z.string().optional().default("main"),
});

// ─── enrichment ─────────────────────────────────────────────────────────────

export const EnrichmentUserPromptRequestSchema = z.object({
  issueId: z.string(),
  draft: EnrichmentDraftSchema,
  context: EnrichmentContextSchema,
  repoContext: EnrichmentRepoContextSchema.optional(),
});
export type EnrichmentUserPromptRequest = z.infer<
  typeof EnrichmentUserPromptRequestSchema
>;

// ─── project state Q&A ───────────────────────────────────────────────────────

const ProjectStateIssueContextSchema = IssueContextSchema.extend({
  blocks: z.array(z.string()).optional(),
  lastStatusChange: z.string().optional(), // ISO string or human-readable
});

export const ProjectStateSystemPromptOptionsSchema = z.object({
  hasLocalTools: z.boolean().optional().default(false),
  hasDevTools: z.boolean().optional().default(false),
  monitoredRepos: z.array(MonitoredRepoInfoSchema).optional().default([]),
});
export type ProjectStateSystemPromptOptions = z.infer<
  typeof ProjectStateSystemPromptOptionsSchema
>;

export const ProjectStateUserPromptRequestSchema = z.object({
  question: z.string(),
  issueContexts: z.array(ProjectStateIssueContextSchema),
  hasTools: z.boolean().optional().default(false),
});
export type ProjectStateUserPromptRequest = z.infer<
  typeof ProjectStateUserPromptRequestSchema
>;
