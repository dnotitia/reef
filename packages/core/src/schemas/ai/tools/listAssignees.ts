import { z } from "zod";
import { CollaboratorSchema } from "../../workspace/collaborator";

/**
 * `query` filters vault members by username/display_name substring (case
 * insensitive). Vault is bound at factory construction so the LLM does not sees
 * which workspace it is reading from — eliminates prompt-injected cross-vault
 * reads.
 */
export const ListAssigneesInputSchema = z.object({
  query: z.string().default(""),
});

export const ListAssigneesOutputSchema = z.object({
  assignees: z.array(CollaboratorSchema),
});

export type ListAssigneesOutput = z.infer<typeof ListAssigneesOutputSchema>;
