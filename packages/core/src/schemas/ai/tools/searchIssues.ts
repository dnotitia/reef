import { z } from "zod";
import {
  IssueSearchResultMetadataSchema,
  StatusEnum,
} from "../../issues/metadata";

/**
 * Hybrid issue search input. Empty `query` falls back to metadata filtering;
 * non-empty queries search issue documents via akb hybrid retrieval and then
 * apply Reef metadata filters to the candidate rows.
 */
export const SearchIssuesInputSchema = z.object({
  query: z.string().default(""),
  status: z.array(StatusEnum).nullable(),
  assigned_to: z.string().nullable(),
  labels: z.array(z.string()).nullable(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const SearchIssuesResultSchema = IssueSearchResultMetadataSchema.extend({
  matched_section: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
});

export type SearchIssuesResult = z.infer<typeof SearchIssuesResultSchema>;

export const SearchIssuesOutputSchema = z.object({
  issues: z.array(SearchIssuesResultSchema),
});

export type SearchIssuesOutput = z.infer<typeof SearchIssuesOutputSchema>;
