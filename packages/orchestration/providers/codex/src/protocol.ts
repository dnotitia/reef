import { z } from "zod";

const requestIdSchema = z.union([z.string().min(1), z.number()]);
const nonEmptyTextSchema = z.string().min(1);

const messageObjectSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length > 0);

export const responseEnvelopeSchema = z
  .strictObject({
    id: requestIdSchema,
    result: z.unknown().optional(),
    error: z
      .looseObject({
        code: z.union([z.string(), z.number()]),
        message: z.string(),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.result === undefined && value.error === undefined) {
      context.addIssue({
        code: "custom",
        message: "response must contain result or error",
      });
    }
    if (value.result !== undefined && value.error !== undefined) {
      context.addIssue({
        code: "custom",
        message: "response cannot contain both result and error",
      });
    }
  });

const methodMessageSchema = z.strictObject({
  method: nonEmptyTextSchema,
  id: requestIdSchema.optional(),
  params: z.unknown().optional(),
});

export const threadResultSchema = z.looseObject({
  thread: z.looseObject({ id: nonEmptyTextSchema }),
});

export const turnResultSchema = z.looseObject({
  turn: z.looseObject({ id: nonEmptyTextSchema }),
});

const threadTurnEnvelopeSchema = z.looseObject({
  threadId: nonEmptyTextSchema,
  turn: z.looseObject({
    id: nonEmptyTextSchema,
  }),
});

export const turnStartedParamsSchema = threadTurnEnvelopeSchema;

export const turnCompletedParamsSchema = z.looseObject({
  threadId: nonEmptyTextSchema,
  turn: z.looseObject({
    id: nonEmptyTextSchema,
    status: z.enum(["completed", "interrupted", "failed"]),
    items: z.array(z.unknown()),
  }),
});

export const itemLifecycleParamsSchema = z.looseObject({
  threadId: nonEmptyTextSchema,
  turnId: nonEmptyTextSchema,
  item: z.looseObject({
    id: nonEmptyTextSchema,
    type: nonEmptyTextSchema,
  }),
});

export const deltaParamsSchema = z.looseObject({
  threadId: nonEmptyTextSchema,
  turnId: nonEmptyTextSchema,
  itemId: nonEmptyTextSchema,
  delta: z.string(),
});

export const threadStatusChangedParamsSchema = z.looseObject({
  threadId: nonEmptyTextSchema,
  status: z.looseObject({
    type: z.enum(["notLoaded", "idle", "systemError", "active"]),
  }),
});

export const errorNotificationParamsSchema = z.looseObject({
  error: messageObjectSchema,
  willRetry: z.boolean(),
  threadId: nonEmptyTextSchema,
  turnId: nonEmptyTextSchema,
});

const userInputOptionSchema = z.looseObject({
  label: nonEmptyTextSchema,
  description: z.string(),
});

const userInputQuestionSchema = z.looseObject({
  id: nonEmptyTextSchema,
  header: nonEmptyTextSchema,
  question: nonEmptyTextSchema,
  options: z.array(userInputOptionSchema).nullable(),
  isOther: z.boolean(),
  isSecret: z.boolean(),
});

export const userInputRequestParamsSchema = z.looseObject({
  threadId: nonEmptyTextSchema,
  turnId: nonEmptyTextSchema,
  itemId: nonEmptyTextSchema,
  questions: z.array(userInputQuestionSchema).min(1),
  autoResolutionMs: z.number().nullable(),
});

export const approvalRequestParamsSchema = z.looseObject({
  threadId: nonEmptyTextSchema,
  turnId: nonEmptyTextSchema,
  itemId: nonEmptyTextSchema,
  reason: z.string().nullable().optional(),
  networkApprovalContext: z.unknown().nullable().optional(),
});

export const finalOutputSchema = z.strictObject({
  intent: z.enum(["completed", "validation_requested", "blocked", "failed"]),
  summary: z.string().trim().min(1).max(512),
});

export type JsonRpcId = z.infer<typeof requestIdSchema>;
export type JsonRpcResponse = z.infer<typeof responseEnvelopeSchema>;
export type FinalOutput = z.infer<typeof finalOutputSchema>;
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
