/** The work collection shown by the Issues workspace. */
export type IssueScope = "active" | "backlog";

/** The rendering layout used for the current issue scope. */
export type IssueLayout = "board" | "list" | "timeline";

export const ISSUE_SCOPES: readonly IssueScope[] = [
  "active",
  "backlog",
] as const;
export const ISSUE_LAYOUTS: readonly IssueLayout[] = [
  "board",
  "list",
  "timeline",
] as const;

const DEFAULT_ISSUE_SCOPE: IssueScope = "active";
const DEFAULT_ISSUE_LAYOUT: IssueLayout = "board";

export interface IssueViewState {
  scope: IssueScope;
  layout: IssueLayout;
}

export function parseScopeParam(value: string | null | undefined): IssueScope {
  return ISSUE_SCOPES.includes(value as IssueScope)
    ? (value as IssueScope)
    : DEFAULT_ISSUE_SCOPE;
}

/**
 * Coerce a raw `?view=` value into a layout. `backlog` is intentionally not a
 * layout value: backlog is a scope, so the old mixed `view=backlog` URL is not
 * interpreted as a compatibility route.
 */
export function parseViewParam(value: string | null | undefined): IssueLayout {
  return ISSUE_LAYOUTS.includes(value as IssueLayout)
    ? (value as IssueLayout)
    : DEFAULT_ISSUE_LAYOUT;
}

/** Backlog has no Timeline layout, so normalize that unsupported combination. */
export function normalizeIssueViewState(
  scope: IssueScope,
  layout: IssueLayout,
): IssueViewState {
  return {
    scope,
    layout: scope === "backlog" && layout === "timeline" ? "list" : layout,
  };
}

export function parseIssueViewState(
  searchParams: Pick<URLSearchParams, "get">,
): IssueViewState {
  return normalizeIssueViewState(
    parseScopeParam(searchParams.get("scope")),
    parseViewParam(searchParams.get("view")),
  );
}
