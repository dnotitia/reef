import { z } from "zod";
import { EnrichmentDraftSchema, EnrichmentRequestSchema } from "./enrichment";

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
// `draft` reuses the issue-create contract for the unsaved New Issue surface;
// unlike `reefId`, it is never a persisted issue lookup key.
const ChatGroundingFieldsSchema = {
  route: z.string().nullable().optional(),
  reefId: z.string().nullable().optional(),
  draft: EnrichmentDraftSchema.nullable().optional(),
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
