import { z } from "zod";

export const SearchCodeInputSchema = z.object({
  query: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  maxResults: z.number().int().min(1).max(100).default(10),
});

export const BoundSearchCodeInputSchema = SearchCodeInputSchema.omit({
  owner: true,
  repo: true,
});

const SearchCodeResultSchema = z.object({
  path: z.string(),
  line: z.number().int(),
  snippet: z.string(),
});

export const SearchCodeOutputSchema = z.object({
  results: z.array(SearchCodeResultSchema),
});
