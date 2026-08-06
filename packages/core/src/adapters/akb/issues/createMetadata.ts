import { DEFAULT_NEW_ISSUE_STATUS } from "../../../models/status";
import type {
  IssueCreateInput,
  IssueMetadata,
} from "../../../schemas/issues/metadata";

/**
 * Build complete reef issue metadata from a create input. Stamps
 * `created_at`/`updated_at` for the returned object; the persisted canonical
 * timestamps come from the `reef_issues` row's akb-auto columns (the row is
 * inserted at creation, so they coincide). `created_by`/`updated_by`/`source`
 * are the reef "semantic actors" stored in the row's `meta` json.
 */
export function buildIssueMetadataFromCreateInput(input: {
  id: string;
  create: IssueCreateInput;
  now?: string;
  source?: string;
  author?: string;
}): IssueMetadata {
  const now = input.now ?? new Date().toISOString();
  const author = input.author ?? "ai-agent";
  const {
    title,
    issue_type,
    priority,
    labels,
    assigned_to,
    requester,
    reporter,
    start_date,
    due_date,
    milestone_id,
    sprint_id,
    release_id,
    estimate_points,
    severity,
    parent_id,
    depends_on,
    blocks,
    related_to,
    external_refs,
    implementation_refs,
    status,
  } = input.create.fields;
  return {
    id: input.id,
    title,
    status: status ?? DEFAULT_NEW_ISSUE_STATUS,
    issue_type: issue_type ?? "task",
    created_at: now,
    created_by: author,
    updated_at: now,
    updated_by: author,
    ...(priority !== undefined && { priority }),
    ...(labels !== undefined && { labels }),
    ...(assigned_to !== undefined && { assigned_to }),
    ...(requester !== undefined && { requester }),
    ...(reporter !== undefined && { reporter }),
    ...(start_date !== undefined && { start_date }),
    ...(due_date !== undefined && { due_date }),
    ...(milestone_id !== undefined && { milestone_id }),
    ...(sprint_id !== undefined && { sprint_id }),
    ...(release_id !== undefined && { release_id }),
    ...(estimate_points !== undefined && { estimate_points }),
    ...(severity !== undefined && { severity }),
    ...(parent_id !== undefined && { parent_id }),
    ...(depends_on !== undefined && { depends_on }),
    ...(blocks !== undefined && { blocks }),
    ...(related_to !== undefined && { related_to }),
    ...(external_refs !== undefined && { external_refs }),
    ...(implementation_refs !== undefined && { implementation_refs }),
    source: input.source ?? "ai-agent:draft_issue",
  };
}
