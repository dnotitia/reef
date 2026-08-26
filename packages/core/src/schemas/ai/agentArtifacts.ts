import { z } from "zod";
import { IsoDateFieldSchema } from "../common/date";
import {
  EnrichmentSuggestionSchema,
  ReferenceSuggestionSchema,
} from "./enrichment";

export const MetadataSchema = z.record(z.string(), z.unknown());
export const AgentArtifactTypeEnum = z.enum([
  "chat_message",
  "field_suggestion",
]);
export type AgentArtifactType = z.infer<typeof AgentArtifactTypeEnum>;

export const AgentErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  recoverable: z.boolean().default(false),
  details: MetadataSchema.default({}),
});
export type AgentError = z.infer<typeof AgentErrorSchema>;

const AgentArtifactBaseSchema = z.object({
  artifact_id: z.string().min(1),
  run_id: z.string().min(1),
  task_id: z.string().min(1),
  created_at: IsoDateFieldSchema,
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
      suggestions: z.array(EnrichmentSuggestionSchema).default([]),
      references: z.array(ReferenceSuggestionSchema).default([]),
    }),
  });

export const AgentArtifactSchema = z.discriminatedUnion("type", [
  AgentChatMessageArtifactSchema,
  AgentFieldSuggestionArtifactSchema,
]);
export type AgentArtifact = z.infer<typeof AgentArtifactSchema>;
