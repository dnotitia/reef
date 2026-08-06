import { z } from "zod";
import {
  IssueCreateInputSchema,
  IssueUpdateInputSchema,
  StatusEnum,
} from "../issues/metadata";

export const ProvenanceSchema = z.object({
  type: z.enum(["commit", "pr"]),
  ref: z.string(),
  repo: z.string(),
  actor: z.string(),
  detectedAt: z.string(),
});

export const PendingDraftSchema = z.object({
  id: z.string().uuid(),
  proposal: z.object({
    operation: z.literal("create"),
    create: IssueCreateInputSchema,
  }),
  provenance: ProvenanceSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  status: z.enum(["pending", "approved", "dismissed"]).default("pending"),
  createdAt: z.string(),
});

export type PendingDraft = z.infer<typeof PendingDraftSchema>;

export const StatusChangeEvidenceSchema = z.object({
  type: z.enum(["commit", "pr"]),
  ref: z.string(),
  repo: z.string(),
  actor: z.string(),
});

export const PendingStatusChangeSchema = z.object({
  id: z.string().uuid(),
  proposal: z.object({
    operation: z.literal("update"),
    update: IssueUpdateInputSchema,
  }),
  issueTitle: z.string().min(1),
  fromStatus: StatusEnum,
  rationale: z.string().min(1),
  evidence: z.array(StatusChangeEvidenceSchema).min(1),
  confidence: z.number().min(0).max(1),
  detectedAt: z.string(),
  status: z.enum(["pending", "approved", "dismissed"]).default("pending"),
  createdAt: z.string(),
});

export type PendingStatusChange = z.infer<typeof PendingStatusChangeSchema>;
export type StatusChangeEvidence = z.infer<typeof StatusChangeEvidenceSchema>;
