import { z } from "zod";
import {
  EnrichmentContextSchema,
  EnrichmentDraftSchema,
  EnrichmentRepoContextSchema,
} from "./enrichment";

// ─── enrichment ─────────────────────────────────────────────────────────────

export const EnrichmentUserPromptRequestSchema = z.object({
  issueId: z.string(),
  draft: EnrichmentDraftSchema,
  context: EnrichmentContextSchema,
  repoContext: EnrichmentRepoContextSchema.optional(),
});
export type EnrichmentUserPromptRequest = z.infer<
  typeof EnrichmentUserPromptRequestSchema
>;
