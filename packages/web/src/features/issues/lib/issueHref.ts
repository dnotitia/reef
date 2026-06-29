import { withVault } from "@/lib/workspaceHref";

/**
 * Build the vault-scoped detail-route href for opening an issue while carrying
 * the current issues-workspace query — `?view=` plus any filter/sort params —
 * so the soft-navigation backdrop keeps the tab the user clicked from instead
 * of falling back to the Board default (REEF-222). Mirrors the
 * query-preservation pattern in ViewSwitcher (`new URLSearchParams(...)`).
 *
 * `vault` promotes the path to `/workspace/{vault}/issues/{id}` (REEF-315). With
 * no params we emit a bare `/workspace/{vault}/issues/{id}` (no trailing `?`),
 * so a hard-navigation / deep-link hit stays clean.
 *
 * `query` is typed structurally so both `URLSearchParams` and the
 * `ReadonlyURLSearchParams` returned by `useSearchParams()` satisfy it without
 * coupling this pure helper to `next/navigation`.
 */
export function buildOpenIssueHref(
  vault: string,
  id: string,
  query: { toString(): string },
): string {
  const queryString = query.toString();
  const path = queryString ? `/issues/${id}?${queryString}` : `/issues/${id}`;
  return withVault(vault, path);
}
