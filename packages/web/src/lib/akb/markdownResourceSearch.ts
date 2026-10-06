import type { MarkdownSearchAdapter } from "@akb/markdown-editor";
import { MarkdownResourceSearchResponseSchema } from "@reef/core";
import { apiFetch, throwHttpError } from "@/lib/apiClient";

/** Search permitted documents and files through Reef's authenticated BFF. */
export const markdownResourceSearchAdapter: MarkdownSearchAdapter = {
  async search(query, context) {
    const vault = context?.vault?.trim();
    const trimmedQuery = query.trim();
    if (!vault || !trimmedQuery) return [];

    const params = new URLSearchParams({
      vault,
      q: trimmedQuery,
      include_files: "true",
    });
    const response = await apiFetch(`/api/documents/search?${params}`, {
      signal: context?.signal,
    });
    if (!response.ok) {
      await throwHttpError(
        response,
        `Resource search failed: ${response.status}`,
      );
    }

    const body = MarkdownResourceSearchResponseSchema.parse(
      await response.json(),
    );
    return body.results.map(({ uri, title, kind, snippet }) => ({
      id: uri,
      title,
      target: uri,
      kind,
      ...(snippet ? { snippet } : {}),
    }));
  },
};
