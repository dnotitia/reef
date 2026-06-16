import { z } from "zod";

/**
 * search_documents — let the enrichment agent find akb documents in the vault to
 * cite as supporting context (REEF-083 AC4). Mirrors `searchIssues` but for the
 * whole-vault document corpus; the agent uses the returned `uri` as a
 * `references` relation target.
 */
export const SearchDocumentsInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(25).default(10),
});

const SearchDocumentsResultSchema = z.object({
  uri: z.string().min(1),
  title: z.string().nullable().optional(),
  collection: z.string().nullable().optional(),
  doc_type: z.string().nullable().optional(),
});

export const SearchDocumentsOutputSchema = z.object({
  documents: z.array(SearchDocumentsResultSchema),
});

export type SearchDocumentsOutput = z.infer<typeof SearchDocumentsOutputSchema>;
