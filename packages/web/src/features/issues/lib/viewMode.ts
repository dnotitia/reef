/**
 * The peer renderings of the issues collection. The active view is carried in
 * the `?view=` URL param so it is shareable / bookmarkable and survives a hard
 * reload. `backlog` is a dedicated view onto the `backlog` status (REEF-109);
 * the others render the active workflow.
 */
export type IssueViewMode = "board" | "list" | "timeline" | "backlog";

export const ISSUE_VIEW_MODES: readonly IssueViewMode[] = [
  "board",
  "list",
  "timeline",
  "backlog",
] as const;

const DEFAULT_ISSUE_VIEW: IssueViewMode = "board";

/**
 * Coerce a raw `?view=` value into a known view mode, falling back to the
 * default for missing / unrecognized values.
 */
export function parseViewParam(
  value: string | null | undefined,
): IssueViewMode {
  return ISSUE_VIEW_MODES.includes(value as IssueViewMode)
    ? (value as IssueViewMode)
    : DEFAULT_ISSUE_VIEW;
}
