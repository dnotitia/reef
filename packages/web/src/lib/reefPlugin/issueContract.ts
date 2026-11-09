import { z } from "zod";

export const WORKSPACES_TOOL = "reef_list_workspaces";
export const ISSUES_TOOL = "reef_list_recent_issues";

export const WorkspacesResult = z.object({ workspaces: z.array(z.string()) });
export const IssuesResult = z.object({
  queried_at: z.iso.datetime(),
  issues: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      updated_at: z.string(),
      document_uri: z.string(),
    }),
  ),
});

export const ReadError = z.object({
  error: z.enum([
    "workspace_denied",
    "unavailable",
    "reauthentication_required",
  ]),
});
