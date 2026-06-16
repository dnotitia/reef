import { z } from "zod";

export const DevReadFileInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  path: z.string().min(1),
  ref: z.string().nullable(),
  startLine: z.number().int().min(1).nullable(),
  endLine: z.number().int().min(1).nullable(),
});

export const BoundDevReadFileInputSchema = DevReadFileInputSchema.omit({
  owner: true,
  repo: true,
});

export const DevReadFileOutputSchema = z.object({
  content: z.string(),
  path: z.string(),
  truncated: z.boolean(),
});

export type DevReadFileOutput = z.infer<typeof DevReadFileOutputSchema>;
