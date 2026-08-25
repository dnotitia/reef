import type { IssueKeyboardScope } from "@/features/issues/stores/useIssueKeyboardStore";
import { parseIssueViewState } from "@/features/issues/lib/viewMode";

export interface CommandIssueTarget {
  issueId: string;
  title: string;
  source: "detail" | IssueKeyboardScope;
}

interface CommandTargetInput {
  pathname: string;
  search: string;
  selectionActive: boolean;
  focusedIssueId: Record<IssueKeyboardScope, string | null>;
  lookupIssue: (id: string) => { id: string; title: string } | undefined;
}

function detailIssueId(pathname: string): string | null {
  const match = pathname.match(/\/issues\/([^/?#]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function resolveIssueKeyboardScope(
  pathname: string,
  search: string,
): IssueKeyboardScope | null {
  if (!/\/issues\/?$/.test(pathname)) return null;
  const { scope, layout } = parseIssueViewState(new URLSearchParams(search));
  if (layout === "list") return scope === "backlog" ? "backlog" : "list";
  if (layout === "board") return "board";
  return null;
}

export function resolveCommandTarget({
  pathname,
  search,
  selectionActive,
  focusedIssueId,
  lookupIssue,
}: CommandTargetInput): CommandIssueTarget | null {
  if (selectionActive) return null;

  const detailId = detailIssueId(pathname);
  if (detailId) {
    const issue = lookupIssue(detailId);
    return {
      issueId: detailId,
      title: issue?.title ?? detailId,
      source: "detail",
    };
  }

  const scope = resolveIssueKeyboardScope(pathname, search);
  if (!scope) return null;
  const issueId = focusedIssueId[scope];
  if (!issueId) return null;
  const issue = lookupIssue(issueId);
  return {
    issueId,
    title: issue?.title ?? issueId,
    source: scope,
  };
}
