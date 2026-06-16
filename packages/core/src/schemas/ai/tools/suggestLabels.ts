import { z } from "zod";

export const SuggestLabelsInputSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
  repoContext: z.string().default(""),
});

const LabelSuggestionSchema = z.object({
  label: z.string().min(1),
  rationale: z.string(),
});

export const SuggestLabelsOutputSchema = z.object({
  suggestions: z.array(LabelSuggestionSchema),
});

export type SuggestLabelsOutput = z.infer<typeof SuggestLabelsOutputSchema>;
