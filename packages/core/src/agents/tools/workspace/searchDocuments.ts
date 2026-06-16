import { tool } from "ai";
import type { AkbAdapter } from "../../../adapters/akb";
import { searchDocuments } from "../../../adapters/akb/core/shared";
import { SchemaValidationError } from "../../../errors";
import {
  SearchDocumentsInputSchema,
  type SearchDocumentsOutput,
  SearchDocumentsOutputSchema,
} from "../../../schemas/ai/tools/searchDocuments";
import { withToolSpan } from "../withToolSpan";

/**
 * search_documents — search the vault's akb documents (specs, decisions, notes,
 * references) so the enrichment agent can cite one as supporting context and
 * propose it as a first-class `references` relation (REEF-083 AC4). akb search
 * is generalized over docs/tables/files, so non-document hits are dropped.
 */
export function createSearchDocumentsTool({
  adapter,
  vault,
}: {
  adapter: AkbAdapter;
  vault: string;
}) {
  return tool({
    description:
      "Search akb documents in the vault (specs, decisions, notes, references) " +
      "to cite as supporting context for the issue. Returns each document's akb " +
      "uri, title, collection, and type. Use a returned uri as a `references` " +
      "target when the issue genuinely builds on that document.",
    inputSchema: SearchDocumentsInputSchema,
    execute: async (input): Promise<SearchDocumentsOutput> => {
      return withToolSpan(
        "reef.tool.search_documents",
        input,
        (span, i) => {
          span.setAttribute("tool.input.query", i.query);
        },
        async (span) => {
          // akb ranks docs/tables/files together and exposes no source-type
          // filter, so over-fetch and keep the top `limit` documents AFTER
          // filtering — otherwise tables/files in the top slice could crowd out
          // real documents (same reason as the web picker route).
          const fetchLimit = Math.min(input.limit * 4, 100);
          const hits = await searchDocuments({
            adapter,
            vault,
            query: input.query,
            limit: fetchLimit,
          });
          const documents = hits
            .filter((hit) => hit.source_type === "document")
            .slice(0, input.limit)
            .map((hit) => ({
              uri: hit.uri,
              title: hit.title ?? null,
              collection: hit.collection ?? null,
              doc_type: hit.doc_type ?? null,
            }));
          const parsed = SearchDocumentsOutputSchema.safeParse({ documents });
          if (!parsed.success) {
            throw new SchemaValidationError({
              field: "searchDocumentsOutput",
              issues: parsed.error.issues.map((i) => i.message),
            });
          }
          span.setAttribute("tool.output.document_count", documents.length);
          return parsed.data;
        },
      );
    },
  });
}
