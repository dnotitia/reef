import { z } from "zod";
import { IssueListItemSchema } from "../issues/metadata";
import { PlanningCatalogSchema } from "../planning/catalog";
import {
  EnrichmentContextSchema,
  EnrichmentDraftSchema,
  EnrichmentRepoContextSchema,
  EnrichmentTemplateSummarySchema,
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

export const PrDetailSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  headBranch: z.string(),
  body: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  mergedAt: z.string().nullable().optional(),
  commitMessages: z.array(z.string()),
});
export type PrDetail = z.infer<typeof PrDetailSchema>;

export const CommitDetailSchema = z.object({
  hash: z.string(),
  message: z.string(),
  branch: z.string(),
  authoredDate: z.string().optional(),
  committedDate: z.string().optional(),
  changedFiles: z.array(z.string()),
});
export type CommitDetail = z.infer<typeof CommitDetailSchema>;

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

// ─── auto-issue generation ───────────────────────────────────────────────────

const AutoIssueActivitySchema = z.object({
  eventType: z.string(),
  actor: z.string(),
  sourceRepo: z.string().optional(),
  pr: PrDetailSchema.optional(),
  commit: CommitDetailSchema.optional(),
});

export const AutoIssueUserPromptRequestSchema = z.object({
  activity: AutoIssueActivitySchema,
  templateCatalog: z.array(EnrichmentTemplateSummarySchema).optional(),
  planningCatalog: PlanningCatalogSchema.optional(),
});
export type AutoIssueUserPromptRequest = z.infer<
  typeof AutoIssueUserPromptRequestSchema
>;

// ─── activity issue linking ──────────────────────────────────────────────────

export const ActivityIssueLinkUserPromptRequestSchema = z.object({
  activity: AutoIssueActivitySchema,
  projectPrefix: z.string(),
});
export type ActivityIssueLinkUserPromptRequest = z.infer<
  typeof ActivityIssueLinkUserPromptRequestSchema
>;

export const ActivityIssueLinkDecisionSchema = z
  .object({
    decision: z.enum(["linked", "possible_link", "no_link"]),
    issue_id: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
  })
  .strict();
export type ActivityIssueLinkDecision = z.infer<
  typeof ActivityIssueLinkDecisionSchema
>;

// ─── status-change rationale ──────────────────────────────────────────────────

export const StatusRationaleUserPromptRequestSchema = z.object({
  issueId: z.string(),
  issueTitle: z.string(),
  fromStatus: z.string(),
  toStatus: z.string(),
  actor: z.string(),
  sourceRepo: z.string().optional(),
  pr: PrDetailSchema.optional(),
  commits: z.array(CommitDetailSchema).optional(),
});
export type StatusRationaleUserPromptRequest = z.infer<
  typeof StatusRationaleUserPromptRequestSchema
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
