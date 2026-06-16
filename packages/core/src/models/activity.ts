/**
 * Extract issue IDs matching {PREFIX}-\d{3,} (case-insensitive prefix).
 *
 * Handles multi-line text (commit messages, PR bodies).
 * Returns deduplicated, uppercased, sorted array of matching IDs.
 *
 * @param text   The text to search (commit message, PR body, branch name, etc.)
 * @param prefix The issue ID prefix (default: "REEF")
 */
export function extractIssueRefs(text: string, prefix = "REEF"): string[] {
  // Escape regex metacharacters in prefix to prevent unintended pattern widening
  // (e.g. --prefix "RE.F" should not match "REXF-001")
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![A-Z0-9])${escapedPrefix}-\\d{3,}`, "gi");
  const matches = [...text.matchAll(pattern)].map((m) => m[0].toUpperCase());
  return [...new Set(matches)].sort();
}
