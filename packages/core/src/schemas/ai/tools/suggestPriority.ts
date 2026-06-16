import { z } from "zod";
import { PriorityEnum } from "../../issues/metadata";

export const SuggestPriorityInputSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
  repoContext: z.string().default(""),
});

export const SuggestPriorityOutputSchema = z.object({
  priority: PriorityEnum,
  rationale: z.string(),
});

export type SuggestPriorityOutput = z.infer<typeof SuggestPriorityOutputSchema>;
