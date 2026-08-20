import { z } from "zod";
import { PROJECT_PREFIX_PATTERN, VaultNameSchema } from "../workspace";
import { AgentArtifactSchema } from "./agents";
import { EnrichmentRequestSchema } from "./enrichment";

const TextPartSchema = z.looseObject({
  type: z.literal("text"),
  text: z.string(),
});

const ToolPartSchema = z.looseObject({
  type: z.string().regex(/^tool-/),
});

const FallbackPartSchema = z.looseObject({
  type: z
    .string()
    .refine((type) => type !== "text" && !type.startsWith("tool-"), {
      message:
        "Part type collides with a known shape (text / tool-*); use the matching schema instead.",
    }),
});

const UIMessagePartSchema = z.union([
  TextPartSchema,
  ToolPartSchema,
  FallbackPartSchema,
]);

const CompatibleUIMessageSchema = z.looseObject({
  id: z.string().min(1).optional(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(UIMessagePartSchema).min(1),
});

const AgentUIMessageSchema = CompatibleUIMessageSchema.extend({
  id: z.string().min(1),
});

// Optional chat-grounding hints the client sends alongside the messages
// (REEF-360). `route` is the app path the PM is on; `reefId` is the issue whose
// sheet is open. Both are tolerant: absent → null. `reefId` is not regex-gated
// here — core re-validates its shape before it reaches the akb read path, which
// is the security boundary for the id (mirrors the `read_issue` tool contract).
const ChatGroundingFieldsSchema = {
  route: z.string().nullable().optional(),
  reefId: z.string().nullable().optional(),
};

export const WorkspaceChatRequestBodySchema = z
  .looseObject({
    messages: z
      .array(CompatibleUIMessageSchema)
      .min(1, "messages must contain at least one message"),
    ...ChatGroundingFieldsSchema,
  })
  .transform((body) => ({
    ...body,
    messages: body.messages.map((message, index) => ({
      ...message,
      id: message.id ?? `chat-message-${index}`,
    })),
  }));
export const WorkspaceChatAgentInputSchema = z.looseObject({
  messages: z
    .array(AgentUIMessageSchema)
    .min(1, "messages must contain at least one message"),
  ...ChatGroundingFieldsSchema,
});
export type WorkspaceChatAgentInput = z.infer<
  typeof WorkspaceChatAgentInputSchema
>;

const WorkspaceChatAgentRunRequestSchema = z.strictObject({
  task_id: z.literal("chat.workspace"),
  input: WorkspaceChatAgentInputSchema,
});

const IssueEnrichmentAgentRunRequestSchema = z.strictObject({
  task_id: z.literal("issue.enrichment"),
  input: EnrichmentRequestSchema,
});

export const AgentRunRequestSchema = z.discriminatedUnion("task_id", [
  WorkspaceChatAgentRunRequestSchema,
  IssueEnrichmentAgentRunRequestSchema,
]);
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentArtifactEditRequestSchema = z.strictObject({
  artifact: AgentArtifactSchema,
  patch: z.record(z.string(), z.unknown()).default({}),
  vault: VaultNameSchema.nullable().default(null),
  actor: z.string().min(1).nullable().default(null),
});
export const AgentArtifactCommandRequestSchema = z.strictObject({
  artifact: AgentArtifactSchema.nullable().default(null),
  vault: VaultNameSchema.nullable().default(null),
  prefix: z
    .string()
    .min(1)
    .regex(
      PROJECT_PREFIX_PATTERN,
      "prefix must start with uppercase A-Z and use only A-Z, 0-9, or underscore",
    )
    .nullable()
    .default(null),
  actor: z.string().min(1).nullable().default(null),
  reason: z.string().min(1).nullable().default(null),
});
