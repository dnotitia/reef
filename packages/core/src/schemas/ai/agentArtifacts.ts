import { z } from "zod";
import { StatusChangeEvidenceSchema } from "../activity/pendingDraft";
import { ActivitySuggestionIdSchema } from "../activity/suggestion";
import { IsoDateFieldSchema } from "../common/date";
import { HttpUrlSchema } from "../common/url";
import {
  IssueCreateInputSchema,
  IssueUpdatePatchSchema,
  StatusEnum,
} from "../issues/metadata";
import { EnrichmentSuggestionSchema } from "./enrichment";

export const MetadataSchema = z.record(z.string(), z.unknown());
const ConfidenceSchema = z.number().min(0).max(1);
const legacyStrictObjectError: z.core.$ZodErrorMap = (issue) => {
  if (issue.code !== "unrecognized_keys") return undefined;
  return `Unrecognized key(s) in object: ${issue.keys
    .map((key) => `'${key}'`)
    .join(", ")}`;
};

export const AgentArtifactStatusEnum = z.enum([
  "pending",
  "edited",
  "approved",
  "dismissed",
]);

export const AgentArtifactTypeEnum = z.enum([
  "chat_message",
  "field_suggestion",
  "issue_create_proposal",
  "issue_update_proposal",
  "status_change_proposal",
]);
export type AgentArtifactType = z.infer<typeof AgentArtifactTypeEnum>;

export const AgentArtifactPersistenceSchema = z.strictObject({
  source_of_truth: z.enum(["client_ephemeral", "akb_activity_suggestion"]),
  activity_suggestion_id: ActivitySuggestionIdSchema.nullable().default(null),
  retention: z.enum(["browser_session", "akb_review_history"]),
});

export const AgentErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  recoverable: z.boolean().default(false),
  details: MetadataSchema.default({}),
});
export type AgentError = z.infer<typeof AgentErrorSchema>;

const AgentArtifactEvidenceSchema = z.object({
  type: z.string().min(1),
  ref: z.string().min(1).nullable().optional(),
  url: HttpUrlSchema.nullable().optional(),
  label: z.string().min(1).nullable().optional(),
  metadata: MetadataSchema.default({}),
});
export type AgentArtifactEvidence = z.infer<typeof AgentArtifactEvidenceSchema>;

const AgentIssueUpdatePatchSchema = IssueUpdatePatchSchema.omit({
  status: true,
  closed_reason: true,
});
const AgentIssueUpdateInputSchema = z.strictObject({
  issue_id: z.string().min(1),
  patch: AgentIssueUpdatePatchSchema,
  content: z.string().optional(),
});
const AgentStatusChangeUpdateInputSchema = z.strictObject({
  issue_id: z.string().min(1),
  patch: z.strictObject(
    { status: StatusEnum },
    { error: legacyStrictObjectError },
  ),
});

const AgentIssueCreateChangeProposalSchema = z.strictObject({
  operation: z.literal("create"),
  create: IssueCreateInputSchema,
});
const AgentIssueUpdateChangeProposalSchema = z.strictObject({
  operation: z.literal("update"),
  update: AgentIssueUpdateInputSchema,
});

const AgentStatusChangeEvidenceSchema = StatusChangeEvidenceSchema.extend({
  ref: z.string().min(1, "String must contain at least 1 character"),
  repo: z.string().min(1, "String must contain at least 1 character"),
  actor: z.string().min(1, "String must contain at least 1 character"),
});

const AgentArtifactBaseSchema = z.object({
  artifact_id: z.string().min(1),
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  status: AgentArtifactStatusEnum.default("pending"),
  title: z.string().min(1).nullable().default(null),
  confidence: ConfidenceSchema.nullable().default(null),
  reasoning: z.string().min(1).nullable().default(null),
  evidence: z.array(AgentArtifactEvidenceSchema).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  created_at: IsoDateFieldSchema,
  updated_at: IsoDateFieldSchema.nullable().default(null),
  metadata: MetadataSchema.default({}),
});

const AgentChatMessageArtifactSchema = AgentArtifactBaseSchema.extend({
  type: z.literal("chat_message"),
  payload: z.object({
    message_id: z.string().min(1).nullable().default(null),
    role: z.enum(["system", "user", "assistant", "tool"]).default("assistant"),
    text: z.string().default(""),
    parts: z.array(MetadataSchema).default([]),
  }),
});
export const AgentFieldSuggestionArtifactSchema =
  AgentArtifactBaseSchema.extend({
    type: z.literal("field_suggestion"),
    payload: z.object({
      issue_id: z.string().min(1).nullable().default(null),
      suggestions: z.array(EnrichmentSuggestionSchema).min(1),
    }),
  });

export const AgentIssueCreateProposalArtifactSchema =
  AgentArtifactBaseSchema.extend({
    type: z.literal("issue_create_proposal"),
    payload: z.object({
      proposal: AgentIssueCreateChangeProposalSchema,
    }),
  });
export type AgentIssueCreateProposalArtifact = z.infer<
  typeof AgentIssueCreateProposalArtifactSchema
>;

const AgentIssueUpdateProposalArtifactSchema = AgentArtifactBaseSchema.extend({
  type: z.literal("issue_update_proposal"),
  payload: z.object({
    proposal: AgentIssueUpdateChangeProposalSchema,
  }),
});
export type AgentIssueUpdateProposalArtifact = z.infer<
  typeof AgentIssueUpdateProposalArtifactSchema
>;

export const AgentStatusChangeProposalArtifactBaseSchema =
  AgentArtifactBaseSchema.extend({
    type: z.literal("status_change_proposal"),
    payload: z.object({
      proposal: z.object({
        operation: z.literal("update"),
        update: AgentStatusChangeUpdateInputSchema,
      }),
      from_status: StatusEnum.nullable(),
      to_status: StatusEnum,
      rationale: z.string().min(1),
      status_evidence: z
        .array(AgentStatusChangeEvidenceSchema)
        .min(1, "Array must contain at least 1 element"),
    }),
  });

const assertStatusChangeProposalMatches = (
  artifact: z.infer<typeof AgentStatusChangeProposalArtifactBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  const proposedStatus = artifact.payload.proposal.update.patch.status;
  if (proposedStatus !== artifact.payload.to_status) {
    ctx.addIssue({
      code: "custom",
      message: "proposal.update.patch.status must match to_status",
      path: ["payload", "proposal", "update", "patch", "status"],
    });
  }
};

export const AgentStatusChangeProposalArtifactSchema =
  AgentStatusChangeProposalArtifactBaseSchema.superRefine(
    assertStatusChangeProposalMatches,
  );
export type AgentStatusChangeProposalArtifact = z.infer<
  typeof AgentStatusChangeProposalArtifactSchema
>;

export const AgentArtifactSchema = z
  .discriminatedUnion("type", [
    AgentChatMessageArtifactSchema,
    AgentFieldSuggestionArtifactSchema,
    AgentIssueCreateProposalArtifactSchema,
    AgentIssueUpdateProposalArtifactSchema,
    AgentStatusChangeProposalArtifactBaseSchema,
  ])
  .superRefine((artifact, ctx) => {
    if (artifact.type === "status_change_proposal") {
      assertStatusChangeProposalMatches(artifact, ctx);
    }
  });
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
