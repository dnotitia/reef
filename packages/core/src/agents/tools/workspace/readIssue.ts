import { tool } from "ai";
import { readIssue } from "../../../adapters/akb";
import type { AkbAdapter } from "../../../adapters/akb";
import { SchemaValidationError } from "../../../errors";
import {
  ReadIssueInputSchema,
  type ReadIssueOutput,
  ReadIssueOutputSchema,
} from "../../../schemas/ai/tools";
import { withToolSpan } from "../withToolSpan";

/**
 * read_issue — Returns the full reef issue (metadata + content) for a
 * given issue id. `vault` is bound at factory construction so the LLM does not
 * sees which workspace it is reading from.
 *
 * NotFoundError propagates as a tool-execution error; the AI SDK surfaces it
 * as the tool result and the model can react accordingly. AuthError bubbles
 * to the agent loop so the route handler can translate it to 401.
 */
export function createReadIssueTool({
  adapter,
  vault,
}: {
  adapter: AkbAdapter;
  vault: string;
}) {
  return tool({
    description:
      "Fetch the full reef issue (title, status, type, priority, assignee, " +
      "planning metadata, relationships, labels, content) for a given issue id.",
    inputSchema: ReadIssueInputSchema,
    execute: async (input): Promise<ReadIssueOutput> => {
      return withToolSpan(
        "reef.tool.read_issue",
        input,
        (span, i) => span.setAttribute("tool.input.id", i.id),
        async () => {
          const { issue, content } = await readIssue({
            adapter,
            vault,
            id: input.id,
          });
          const output: ReadIssueOutput = { issue, content };
          const parsed = ReadIssueOutputSchema.safeParse(output);
          if (!parsed.success) {
            throw new SchemaValidationError({
              field: "readIssueOutput",
              issues: parsed.error.issues.map((i) => i.message),
            });
          }
          return parsed.data;
        },
      );
    },
  });
}
