import { z } from "zod";

export const ResolveMarkdownTargetRequestSchema = z.strictObject({
  target: z.string().min(1).max(2048),
});

export const MarkdownTargetAccessResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    target: z.string().min(1),
    kind: z.enum(["document", "file"]),
    status: z.literal("available"),
  }),
  z.strictObject({
    target: z.string().min(1),
    kind: z.enum(["document", "file"]).optional(),
    status: z.literal("unavailable"),
    reason: z.enum([
      "deleted",
      "inaccessible",
      "unsupported",
      "cross-vault",
      "unknown",
    ]),
  }),
]);

export type ResolveMarkdownTargetRequest = z.infer<
  typeof ResolveMarkdownTargetRequestSchema
>;

export type MarkdownTargetAccessResult = z.infer<
  typeof MarkdownTargetAccessResultSchema
>;
