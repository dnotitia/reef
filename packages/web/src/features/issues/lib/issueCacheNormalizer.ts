import type { IssueDocument, IssueListItem } from "@reef/core";
import type { Query, QueryClient } from "@tanstack/react-query";
import { upsertIssue, upsertIssues } from "../stores/issueEntityStore";
import { toListItem } from "./toListItem";

/**
 * Mirror one issue query's data into the normalized entity store.
 *
 * The store is fed from a single place — the QueryClient cache — so every issue
 * read path (a list fetch, a detail fetch, an optimistic cache write, and the
 * persisted-snapshot rehydration on reload) lands the same entities in the
 * store without each hook having to remember to normalize. Only `['issues',…]`
 * queries are relevant:
 *   - `['issues','list',vault]` / `['issues','list',vault,<query>]` → list items
 *   - `['issues','detail',vault,id]` → the document's `issue`, projected to a
 *     list item.
 * Relations (`['issues','relations',vault]`) stay query-owned — they are a
 * separate whole-vault projection, not per-entity content.
 */
function normalizeIssueQuery(query: Query): void {
  const key = query.queryKey;
  if (!Array.isArray(key) || key[0] !== "issues") return;
  const vault = key[2];
  if (typeof vault !== "string" || vault === "") return;
  const data = query.state.data;
  if (data == null) return;

  if (key[1] === "list" && Array.isArray(data)) {
    upsertIssues(vault, data as IssueListItem[]);
    return;
  }
  if (key[1] === "detail" && typeof key[3] === "string") {
    const doc = data as IssueDocument;
    if (doc.issue) upsertIssue(vault, toListItem(doc.issue));
  }
}

/**
 * Attach the entity-store normalizer to a QueryClient. Sweeps whatever is
 * already cached (the rehydrated persisted snapshot may have landed before this
 * runs), then subscribes for subsequent fetches and cache writes. Returns the
 * unsubscribe handle.
 */
export function startIssueEntityNormalizer(
  queryClient: QueryClient,
): () => void {
  const cache = queryClient.getQueryCache();
  for (const query of cache.getAll()) normalizeIssueQuery(query);
  return cache.subscribe((event) => {
    if (event.type === "added" || event.type === "updated") {
      normalizeIssueQuery(event.query);
    }
  });
}
