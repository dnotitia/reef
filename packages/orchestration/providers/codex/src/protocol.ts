import { z } from "zod";

const requestIdSchema = z.union([z.string().min(1), z.number().finite()]);
const nonEmptyTextSchema = z.string().min(1);

const messageObjectSchema = z
  .record(z.unknown())
  .refine((value) => Object.keys(value).length > 0);

export const responseEnvelopeSchema = z
  .object({
    id: requestIdSchema,
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.union([z.string(), z.number().finite()]),
        message: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.result === undefined && value.error === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "response must contain result or error",
      });
    }
    if (value.result !== undefined && value.error !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "response cannot contain both result and error",
      });
    }
  });

const methodMessageSchema = z
  .object({
    method: nonEmptyTextSchema,
    id: requestIdSchema.optional(),
    params: z.unknown().optional(),
  })
  .strict();

export const threadResultSchema = z
  .object({
    thread: z.object({ id: nonEmptyTextSchema }).passthrough(),
  })
  .passthrough();

export const turnResultSchema = z
  .object({
    turn: z.object({ id: nonEmptyTextSchema }).passthrough(),
  })
  .passthrough();

const threadTurnEnvelopeSchema = z
  .object({
    threadId: nonEmptyTextSchema,
    turn: z
      .object({
        id: nonEmptyTextSchema,
      })
      .passthrough(),
  })
  .passthrough();

export const turnStartedParamsSchema = threadTurnEnvelopeSchema;

export const turnCompletedParamsSchema = z
  .object({
    threadId: nonEmptyTextSchema,
    turn: z
      .object({
        id: nonEmptyTextSchema,
        status: z.enum(["completed", "interrupted", "failed"]),
        items: z.array(z.unknown()),
      })
      .passthrough(),
  })
  .passthrough();

export const itemLifecycleParamsSchema = z
  .object({
    threadId: nonEmptyTextSchema,
    turnId: nonEmptyTextSchema,
    item: z
      .object({
        id: nonEmptyTextSchema,
        type: nonEmptyTextSchema,
      })
      .passthrough(),
  })
  .passthrough();

export const deltaParamsSchema = z
  .object({
    threadId: nonEmptyTextSchema,
    turnId: nonEmptyTextSchema,
    itemId: nonEmptyTextSchema,
    delta: z.string(),
  })
  .passthrough();

export const threadStatusChangedParamsSchema = z
  .object({
    threadId: nonEmptyTextSchema,
    status: z
      .object({
        type: z.enum(["notLoaded", "idle", "systemError", "active"]),
      })
      .passthrough(),
  })
  .passthrough();

export const errorNotificationParamsSchema = z
  .object({
    error: messageObjectSchema,
    willRetry: z.boolean(),
    threadId: nonEmptyTextSchema,
    turnId: nonEmptyTextSchema,
  })
  .passthrough();

const userInputOptionSchema = z
  .object({
    label: nonEmptyTextSchema,
    description: z.string(),
  })
  .passthrough();

const userInputQuestionSchema = z
  .object({
    id: nonEmptyTextSchema,
    header: nonEmptyTextSchema,
    question: nonEmptyTextSchema,
    options: z.array(userInputOptionSchema).nullable(),
    isOther: z.boolean(),
    isSecret: z.boolean(),
  })
  .passthrough();

export const userInputRequestParamsSchema = z
  .object({
    threadId: nonEmptyTextSchema,
    turnId: nonEmptyTextSchema,
    itemId: nonEmptyTextSchema,
    questions: z.array(userInputQuestionSchema).min(1),
    autoResolutionMs: z.number().finite().nullable(),
  })
  .passthrough();

export const approvalRequestParamsSchema = z
  .object({
    threadId: nonEmptyTextSchema,
    turnId: nonEmptyTextSchema,
    itemId: nonEmptyTextSchema,
    reason: z.string().nullable().optional(),
    networkApprovalContext: z.unknown().nullable().optional(),
  })
  .passthrough();

export const finalOutputSchema = z
  .object({
    intent: z.enum(["completed", "validation_requested", "blocked", "failed"]),
    summary: z.string().trim().min(1).max(512),
  })
  .strict();

export type JsonRpcId = z.infer<typeof requestIdSchema>;
export type JsonRpcResponse = z.infer<typeof responseEnvelopeSchema>;
export type FinalOutput = z.infer<typeof finalOutputSchema>;
export type MethodMessage = z.infer<typeof methodMessageSchema>;

export type CodexMessage =
  | { readonly type: "response"; readonly value: JsonRpcResponse }
  | {
      readonly type: "request";
      readonly id: JsonRpcId;
      readonly method: string;
      readonly params: unknown;
    }
  | {
      readonly type: "notification";
      readonly method: string;
      readonly params: unknown;
    };

export function parseJsonLine(line: string): CodexMessage {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new Error("invalid_jsonl_message");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid_jsonl_envelope");
  }

  const record = value as Record<string, unknown>;
  if ("method" in record) {
    const parsed = methodMessageSchema.safeParse(value);
    if (!parsed.success) throw new Error("invalid_jsonl_method_message");
    if (parsed.data.id === undefined) {
      return {
        type: "notification",
        method: parsed.data.method,
        params: parsed.data.params ?? {},
      };
    }
    return {
      type: "request",
      id: parsed.data.id,
      method: parsed.data.method,
      params: parsed.data.params ?? {},
    };
  }

  const parsed = responseEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new Error("invalid_jsonl_response");
  return { type: "response", value: parsed.data };
}

export function parseFinalOutput(text: string): FinalOutput | null {
  if (text.length > 16_384) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    const result = finalOutputSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function finalOutputFromItems(
  items: readonly unknown[],
): FinalOutput | null {
  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.type !== "agentMessage" || typeof record.text !== "string") {
      continue;
    }
    const output = parseFinalOutput(record.text);
    if (output) return output;
  }
  return null;
}

export function protocolValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("invalid_codex_protocol_value");
  return parsed.data;
}
