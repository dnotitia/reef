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

/** Canonical vault-scoped List URL for a planning kind. */
export function planningListHref(vault: string, kind: PlanningKind): string {
  const params = new URLSearchParams({ view: "list", kind });
  return withVault(vault, `/planning?${params.toString()}`);
}

/** Canonical List URL that opens a milestone or release detail panel. */
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

/** Canonical vault-scoped Issues URL filtered to one planning item. */
export function planningIssueFilterHref(
  vault: string,
  kind: PlanningKind,
  itemId: string,
): string {
  const filterKey = {
    sprints: "sprint_id",
    milestones: "milestone_id",
    releases: "release_id",
  }[kind];
  const params = new URLSearchParams({ [filterKey]: itemId });
  return withVault(vault, `/issues?${params.toString()}`);
}
