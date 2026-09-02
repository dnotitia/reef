import { withVault } from "@/lib/workspaceHref";

/** Dashboard-relative path for a sprint detail surface. */
export function sprintDetailPath(sprintId: string): string {
  return `/planning/sprints/${encodeURIComponent(sprintId)}`;
}

/** Canonical URL for a vault-owned sprint detail surface. */
export function sprintDetailHref(vault: string, sprintId: string): string {
  return withVault(vault, sprintDetailPath(sprintId));
}
