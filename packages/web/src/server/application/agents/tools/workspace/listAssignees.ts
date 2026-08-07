import {
  akbFilterVaultMembers,
  akbListVaultMembers,
  akbVaultMemberToCollaborator,
} from "@reef/core";
import type { AkbAdapter } from "@reef/core";
import { SchemaValidationError } from "@reef/core";
import {
  ListAssigneesInputSchema,
  type ListAssigneesOutput,
  ListAssigneesOutputSchema,
} from "@reef/core";
import { tool } from "ai";
import { withToolSpan } from "../withToolSpan";

const MAX_RESULTS = 10;

/**
 * list_assignees — Returns vault members matching a search query.
 *
 * Filters `akbListVaultMembers` results in memory by username/display_name
 * substring (case insensitive). `vault` is closure-bound at factory
 * construction so a prompt-injected workspace name does not redirect the call.
 *
 * Returned members are mapped to the existing `Collaborator` wire shape so
 * the chat-side UI does not need a new type.
 */
export function createListAssigneesTool({
  adapter,
  vault,
}: {
  adapter: AkbAdapter;
  vault: string;
}) {
  return tool({
    description:
      "List workspace members matching a search query for use as issue assignees. " +
      "Returns up to 10 members with login and display name.",
    inputSchema: ListAssigneesInputSchema,
    execute: async (input): Promise<ListAssigneesOutput> => {
      return withToolSpan(
        "reef.tool.list_assignees",
        input,
        (span, i) => span.setAttribute("tool.input.query", i.query),
        async (span) => {
          const { members } = await akbListVaultMembers({ adapter, vault });
          const assignees = akbFilterVaultMembers(members, input.query)
            .slice(0, MAX_RESULTS)
            .map(akbVaultMemberToCollaborator);

          const parsed = ListAssigneesOutputSchema.safeParse({ assignees });
          if (!parsed.success) {
            throw new SchemaValidationError({
              field: "listAssigneesOutput",
              issues: parsed.error.issues.map((i) => i.message),
            });
          }
          span.setAttribute("tool.output.assignee_count", assignees.length);
          return parsed.data;
        },
      );
    },
  });
}
