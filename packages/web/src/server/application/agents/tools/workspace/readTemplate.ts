import { akbReadTemplate } from "@reef/core";
import type { AkbAdapter } from "@reef/core";
import { SchemaValidationError } from "@reef/core";
import {
  ReadTemplateInputSchema,
  type ReadTemplateOutput,
  ReadTemplateOutputSchema,
} from "@reef/core";
import { tool } from "ai";
import { withToolSpan } from "../withToolSpan";

/**
 * read_template — Returns a full issue template, including markdown body.
 *
 * The enrichment prompt receives template metadata up front. The body is fetched
 * when the model decides a specific template should shape the draft
 * description, keeping the baseline prompt compact without hiding template
 * structure from the agent.
 */
export function createReadTemplateTool({
  adapter,
  vault,
}: {
  adapter: AkbAdapter;
  vault: string;
}) {
  return tool({
    description:
      "Fetch a full Reef issue template by name, including markdown body, default labels, title prefix, and priority.",
    inputSchema: ReadTemplateInputSchema,
    execute: async (input): Promise<ReadTemplateOutput> => {
      return withToolSpan(
        "reef.tool.read_template",
        input,
        (span, i) => span.setAttribute("tool.input.name", i.name),
        async () => {
          const { template } = await akbReadTemplate({
            adapter,
            vault,
            name: input.name,
          });
          const parsed = ReadTemplateOutputSchema.safeParse(template);
          if (!parsed.success) {
            throw new SchemaValidationError({
              field: "readTemplateOutput",
              issues: parsed.error.issues.map((i) => i.message),
            });
          }
          return parsed.data;
        },
      );
    },
  });
}
