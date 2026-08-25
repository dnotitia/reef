import {
  type IssueLayout,
  normalizeIssueViewState,
  parseIssueViewState,
} from "@/features/issues/lib/viewMode";
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
  view: IssueLayout;
}): string {
  const inIssuesWorkspace = /\/workspace\/[^/]+\/issues(?:\/[^/]+)?\/?$/.test(
    pathname,
  );
  const params = inIssuesWorkspace
    ? new URLSearchParams(search)
    : new URLSearchParams();
  const scope = params.get("scope") === "backlog" ? "backlog" : "active";
  params.set("scope", scope);
  params.set("view", normalizeIssueViewState(scope, view).layout);
  return withVault(vault, `/issues?${params.toString()}`);
}

export function resolveCurrentIssueView({
  pathname,
  search,
}: {
  pathname: string;
  search: string;
}): IssueLayout | null {
  if (!/\/workspace\/[^/]+\/issues(?:\/[^/]+)?\/?$/.test(pathname)) {
    return null;
  }
  return parseIssueViewState(new URLSearchParams(search)).layout;
}
