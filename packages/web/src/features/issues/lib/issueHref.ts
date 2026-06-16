/**
 * Build the detail-route href for opening an issue while carrying the current
 * issues-workspace query — `?view=` plus any filter/sort params — so the
 * soft-navigation backdrop keeps the tab the user clicked from instead of
 * falling back to the Board default (REEF-222). Mirrors the query-preservation
 * pattern in ViewSwitcher (`new URLSearchParams(searchParams)`).
 *
 * With no params we emit a bare `/issues/{id}` (no trailing `?`), so a
 * hard-navigation / deep-link hit is byte-for-byte unchanged.
 *
 * `query` is typed structurally so both `URLSearchParams` and the
 * `ReadonlyURLSearchParams` returned by `useSearchParams()` satisfy it without
 * coupling this pure helper to `next/navigation`.
 */
export function buildOpenIssueHref(
  id: string,
  query: { toString(): string },
): string {
  const queryString = query.toString();
  return queryString ? `/issues/${id}?${queryString}` : `/issues/${id}`;
}
