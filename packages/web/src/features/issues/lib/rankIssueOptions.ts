import type { IssueListItem } from "@reef/core";

export interface IssueOptionMatch {
  issue: IssueListItem;
  /**
   * Where the query was matched. `id` ranks higher than `title` so an
   * exact ID lookup (e.g. typing "REEF-001") brings the issue to the top
   * even if other titles contain the same substring.
   */
  matchedField: "id" | "title";
  /** Lower is better. Position of the first match within the matched field. */
  matchIndex: number;
}

/**
 * Filter and rank issues for the relation-combobox dropdown (`IssueRelationInput`).
 *
 * The combobox matches over an already-loaded candidate array (a bounded
 * prop, not a server query), so this stays a pure client matcher. The global
 * ⌘K palette deliberately does NOT use this — it shares the server-side `q`
 * search path with the issues list (REEF-034/080).
 *
 * Rules:
 *   - Case-insensitive substring match against `id` and `title`.
 *   - Archived issues are excluded unconditionally — the combobox keeps them in
 *     its `candidates` so the free-text "Use …" affordance can still add an
 *     archived id by hand, but they does not surface as ranked matches.
 *   - Trimmed empty query → empty result (the caller renders a recent list).
 *   - Sort priority: id match before title match, then earliest match
 *     position, then alphabetical id as a deterministic tiebreaker.
 */
export function rankIssueOptions(
  issues: readonly IssueListItem[],
  query: string,
  limit = 20,
): IssueOptionMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const needle = trimmed.toLowerCase();
  const matches: IssueOptionMatch[] = [];

  for (const issue of issues) {
    if (issue.archived_at) continue;

    const idIdx = issue.id.toLowerCase().indexOf(needle);
    if (idIdx >= 0) {
      matches.push({ issue, matchedField: "id", matchIndex: idIdx });
      continue;
    }
    const titleIdx = issue.title.toLowerCase().indexOf(needle);
    if (titleIdx >= 0) {
      matches.push({ issue, matchedField: "title", matchIndex: titleIdx });
    }
  }

  matches.sort((a, b) => {
    if (a.matchedField !== b.matchedField) {
      return a.matchedField === "id" ? -1 : 1;
    }
    if (a.matchIndex !== b.matchIndex) return a.matchIndex - b.matchIndex;
    return a.issue.id.localeCompare(b.issue.id);
  });

  return matches.slice(0, limit);
}
