import { z } from "zod";

export const WORKSPACES_TOOL = "reef_list_workspaces";
export const ISSUES_TOOL = "reef_list_recent_issues";

export const WorkspacesResult = z.object({ workspaces: z.array(z.string()) });
export const IssuePeriod = z.literal([7, 30]);
export const IssueSnapshot = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  updated_at: z.string(),
  document_uri: z.string(),
});
export const IssuesResult = z.object({
  queried_at: z.iso.datetime(),
  as_of: z.iso.datetime(),
  next_cursor: z.string().nullable(),
  issues: z.array(IssueSnapshot),
});

export type QueriedIssue = z.infer<typeof IssueSnapshot> & {
  queried_at: string;
};
export type IssueFilters = {
  workspace: string;
  days: z.infer<typeof IssuePeriod>;
  status?: string;
};

export function issueContextText(issues: Iterable<QueriedIssue>): string {
  const selected = Array.from(
    issues,
    ({ id, title, status, updated_at, queried_at, document_uri }) => ({
      id,
      title,
      status,
      updated_at,
      queried_at,
      document_uri,
    }),
  );
  return `Issue Context\n\n${JSON.stringify({ issues: selected }, null, 2)}`;
}

export const ReadError = z.object({
  error: z.enum([
    "workspace_denied",
    "unavailable",
    "reauthentication_required",
  ]),
});
