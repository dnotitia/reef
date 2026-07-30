import type { IssueViewMode } from "@/features/issues/lib/viewMode";
import { withVault } from "@/lib/workspaceHref";

export function buildNavigationHref(vault: string, href: string): string {
  return withVault(vault, href);
}

export function buildViewHref({
  vault,
  pathname,
  search,
  view,
}: {
  vault: string;
  pathname: string;
  search: string;
  view: IssueViewMode;
}): string {
  const inIssuesWorkspace = /\/workspace\/[^/]+\/issues(?:\/[^/]+)?\/?$/.test(
    pathname,
  );
  const params = inIssuesWorkspace
    ? new URLSearchParams(search)
    : new URLSearchParams();
  params.set("view", view);
  return withVault(vault, `/issues?${params.toString()}`);
}
