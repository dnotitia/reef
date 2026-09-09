import { withVault } from "@/lib/workspaceHref";
import type { PlanningKind } from "@reef/core/fields/planning";

/** Dashboard-relative path for a sprint detail surface. */
export function sprintDetailPath(sprintId: string): string {
  return `/planning/sprints/${encodeURIComponent(sprintId)}`;
}

/** Canonical URL for a vault-owned sprint detail surface. */
export function sprintDetailHref(vault: string, sprintId: string): string {
  return withVault(vault, sprintDetailPath(sprintId));
}

/** Canonical List URL that opens a milestone or release's existing disclosure. */
export function planningListDetailHref(
  vault: string,
  kind: PlanningKind,
  itemId: string,
): string {
  const params = new URLSearchParams({
    view: "list",
    kind,
    detail: itemId,
  });
  return withVault(vault, `/planning?${params.toString()}`);
}
