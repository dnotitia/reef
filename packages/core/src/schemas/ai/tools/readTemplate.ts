import { z } from "zod";
import { TEMPLATE_NAME_PATTERN, TemplateSchema } from "../../issues/template";

export const ReadTemplateInputSchema = z.object({
  /** Template row key. Vault is bound at factory construction. */
  name: z.string().regex(TEMPLATE_NAME_PATTERN),
});

export const ReadTemplateOutputSchema = TemplateSchema;
export type ReadTemplateOutput = z.infer<typeof ReadTemplateOutputSchema>;
