import { z } from "zod";
import { PROJECT_PREFIX_PATTERN, VaultNameSchema } from "../workspace";
import { AgentArtifactSchema } from "./agents";
import { EnrichmentRequestSchema } from "./enrichment";

const TextPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

const ToolPartSchema = z
  .object({
    type: z.string().regex(/^tool-/),
  })
  .passthrough();

const FallbackPartSchema = z
  .object({
    type: z
      .string()
      .refine((type) => type !== "text" && !type.startsWith("tool-"), {
        message:
          "Part type collides with a known shape (text / tool-*); use the matching schema instead.",
      }),
  })
  .passthrough();

const UIMessagePartSchema = z.union([
  TextPartSchema,
  ToolPartSchema,
  FallbackPartSchema,
]);

const CompatibleUIMessageSchema = z
  .object({
    id: z.string().min(1).optional(),
    role: z.enum(["system", "user", "assistant"]),
    parts: z.array(UIMessagePartSchema).min(1),
  })
  .passthrough();

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
  .object({
    messages: z
      .array(CompatibleUIMessageSchema)
      .min(1, "messages must contain at least one message"),
    ...ChatGroundingFieldsSchema,
  })
  .passthrough()
  .transform((body) => ({
    ...body,
    messages: body.messages.map((message, index) => ({
      ...message,
      id: message.id ?? `chat-message-${index}`,
    })),
  }));
export const WorkspaceChatAgentInputSchema = z
  .object({
    messages: z
      .array(AgentUIMessageSchema)
      .min(1, "messages must contain at least one message"),
    ...ChatGroundingFieldsSchema,
  })
  .passthrough();
export type WorkspaceChatAgentInput = z.infer<
  typeof WorkspaceChatAgentInputSchema
>;

export const ActivityScanAgentInputSchema = z
  .object({
    owner: z.string().min(1),
    repo: z.string().min(1),
    vault: VaultNameSchema,
    since: z.string().min(1).nullable().default(null),
    projectPrefix: z.string().min(1),
  })
  .strict();
export type ActivityScanAgentInput = z.infer<
  typeof ActivityScanAgentInputSchema
>;

const WorkspaceChatAgentRunRequestSchema = z
  .object({
    task_id: z.literal("chat.workspace"),
    input: WorkspaceChatAgentInputSchema,
  })
  .strict();

const IssueEnrichmentAgentRunRequestSchema = z
  .object({
    task_id: z.literal("issue.enrichment"),
    input: EnrichmentRequestSchema,
  })
  .strict();

const ActivityScanAgentRunRequestSchema = z
  .object({
    task_id: z.literal("activity.scan"),
    input: ActivityScanAgentInputSchema,
  })
  .strict();

export const AgentRunRequestSchema = z.discriminatedUnion("task_id", [
  WorkspaceChatAgentRunRequestSchema,
  IssueEnrichmentAgentRunRequestSchema,
  ActivityScanAgentRunRequestSchema,
]);
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const AgentArtifactEditRequestSchema = z
  .object({
    artifact: AgentArtifactSchema,
    patch: z.record(z.unknown()).default({}),
    vault: VaultNameSchema.nullable().default(null),
    actor: z.string().min(1).nullable().default(null),
  })
  .strict();
export const AgentArtifactCommandRequestSchema = z
  .object({
    artifact: AgentArtifactSchema.nullable().default(null),
    vault: VaultNameSchema.nullable().default(null),
    prefix: z
      .string()
      .min(1)
      .regex(PROJECT_PREFIX_PATTERN, "prefix must be uppercase A-Z only")
      .nullable()
      .default(null),
    actor: z.string().min(1).nullable().default(null),
    reason: z.string().min(1).nullable().default(null),
  })
  .strict();
