import { z } from "zod";
import {
  IssueCreateInputSchema,
  IssueUpdateInputSchema,
  StatusEnum,
} from "../issues/metadata";
import { ProvenanceSchema, StatusChangeEvidenceSchema } from "./pendingDraft";

export const ActivitySuggestionIdSchema = z
  .string()
  .regex(/^reef-(draft|status)-[a-f0-9]{16}$/, "Invalid suggestion id");

export const ActivitySuggestionStatusSchema = z.enum([
  "pending",
  "approved",
  "dismissed",
]);
export type ActivitySuggestionStatus = z.infer<
  typeof ActivitySuggestionStatusSchema
>;

const ActivitySuggestionBaseSchema = z.object({
  id: z.string().min(1),
  status: ActivitySuggestionStatusSchema.default("pending"),
  fingerprint: z.string().min(1),
  repo: z.string().min(1),
  created_at: z.string().min(1),
  detected_at: z.string().min(1),
  reviewed_at: z.string().nullable().optional(),
  reviewed_by: z.string().nullable().optional(),
});

export const ActivityDraftSuggestionSchema =
  ActivitySuggestionBaseSchema.extend({
    kind: z.literal("draft"),
    proposal: z.object({
      operation: z.literal("create"),
      create: IssueCreateInputSchema,
    }),
    provenance: ProvenanceSchema,
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    approved_issue_id: z.string().nullable().optional(),
  });

export const ActivityStatusChangeSuggestionSchema =
  ActivitySuggestionBaseSchema.extend({
    kind: z.literal("status_change"),
    proposal: z.object({
      operation: z.literal("update"),
      update: IssueUpdateInputSchema,
    }),
    issue_title: z.string().min(1),
    from_status: StatusEnum,
    rationale: z.string().min(1),
    evidence: z.array(StatusChangeEvidenceSchema).min(1),
    confidence: z.number().min(0).max(1),
  });

const ActivitySuggestionUnionSchema = z.discriminatedUnion("kind", [
  ActivityDraftSuggestionSchema,
  ActivityStatusChangeSuggestionSchema,
]);

export const ActivitySuggestionSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.proposal !== undefined) return value;

  if (candidate.kind === "draft") {
    const {
      title,
      description,
      issue_type,
      priority,
      assigned_to,
      requester,
      reporter,
      start_date,
      due_date,
      milestone_id,
      sprint_id,
      release_id,
      estimate_points,
      severity,
      parent_id,
      depends_on,
      blocks,
      related_to,
      implementation_refs,
      labels,
      ...rest
    } = candidate;
    return {
      ...rest,
      kind: "draft",
      proposal: {
        operation: "create",
        create: {
          fields: {
            title,
            ...(issue_type !== undefined ? { issue_type } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(assigned_to !== undefined ? { assigned_to } : {}),
            ...(requester !== undefined ? { requester } : {}),
            ...(reporter !== undefined ? { reporter } : {}),
            ...(start_date !== undefined ? { start_date } : {}),
            ...(due_date !== undefined ? { due_date } : {}),
            ...(milestone_id !== undefined ? { milestone_id } : {}),
            ...(sprint_id !== undefined ? { sprint_id } : {}),
            ...(release_id !== undefined ? { release_id } : {}),
            ...(estimate_points !== undefined ? { estimate_points } : {}),
            ...(severity !== undefined ? { severity } : {}),
            ...(parent_id !== undefined ? { parent_id } : {}),
            ...(depends_on !== undefined ? { depends_on } : {}),
            ...(blocks !== undefined ? { blocks } : {}),
            ...(related_to !== undefined ? { related_to } : {}),
            ...(implementation_refs !== undefined
              ? { implementation_refs }
              : {}),
            ...(labels !== undefined ? { labels } : {}),
          },
          content: typeof description === "string" ? description : "",
        },
      },
    };
  }

  if (candidate.kind === "status_change") {
    const { issue_id, to_status, ...rest } = candidate;
    return {
      ...rest,
      kind: "status_change",
      proposal: {
        operation: "update",
        update: {
          issue_id,
          patch: { status: to_status },
        },
      },
    };
  }

  return value;
}, ActivitySuggestionUnionSchema);

export const ActivitySuggestionsResultSchema = z.object({
  suggestions: z.array(ActivitySuggestionSchema),
});

export type ActivityDraftSuggestion = z.infer<
  typeof ActivityDraftSuggestionSchema
>;
export type ActivityStatusChangeSuggestion = z.infer<
  typeof ActivityStatusChangeSuggestionSchema
>;
export type ActivitySuggestion = z.infer<typeof ActivitySuggestionUnionSchema>;
export type ActivitySuggestionsResult = z.infer<
  typeof ActivitySuggestionsResultSchema
>;
