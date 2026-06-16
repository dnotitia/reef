import type { IssueMetadata } from "../schemas/issues/metadata";

export const SAMPLE_ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Fix the login flow",
  status: "todo",
  priority: "high",
  assigned_to: "alice",
  labels: ["bug", "frontend"],
  depends_on: ["REEF-002"],
  blocks: ["REEF-010"],
  source: "ai-action",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-10T00:00:00.000Z",
  updated_by: "bob",
};

export const SAMPLE_BODY =
  "## Repro steps\n\n1. open page\n2. observe failure\n";

export const ISSUE_ROW_COLUMNS = [
  "id",
  "document_uri",
  "reef_id",
  "title",
  "status",
  "priority",
  "assigned_to",
  "issue_type",
  "requester",
  "reporter",
  "start_date",
  "due_date",
  "milestone_id",
  "sprint_id",
  "release_id",
  "estimate_points",
  "severity",
  "rank",
  "closed_at",
  "closed_reason",
  "parent_id",
  "labels",
  "depends_on",
  "related_to",
  "blocks",
  "archived_at",
  "meta",
  "created_at",
  "updated_at",
  "created_by",
];

export function makeIssueRow(
  issue: IssueMetadata = SAMPLE_ISSUE,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 1,
    document_uri: "akb://reef-sample/doc/issues/reef-001.md",
    reef_id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority ?? null,
    assigned_to: issue.assigned_to ?? null,
    issue_type: issue.issue_type ?? "task",
    requester: issue.requester ?? null,
    reporter: issue.reporter ?? null,
    start_date: issue.start_date ?? null,
    due_date: issue.due_date ?? null,
    milestone_id: issue.milestone_id ?? null,
    sprint_id: issue.sprint_id ?? null,
    release_id: issue.release_id ?? null,
    estimate_points: issue.estimate_points ?? null,
    severity: issue.severity ?? null,
    rank: issue.rank ?? null,
    closed_at: issue.closed_at ?? null,
    closed_reason: issue.closed_reason ?? null,
    parent_id: issue.parent_id ?? null,
    labels: issue.labels ?? [],
    depends_on: issue.depends_on ?? [],
    related_to: issue.related_to ?? [],
    blocks: issue.blocks ?? [],
    archived_at: issue.archived_at ?? null,
    meta: {
      author: issue.created_by,
      last_editor: issue.updated_by,
      source: issue.source ?? null,
      last_status_change: issue.last_status_change ?? null,
      external_refs: issue.external_refs ?? null,
      implementation_refs: issue.implementation_refs ?? null,
      watchers: issue.watchers ?? null,
      reviewers: issue.reviewers ?? null,
      qa_owner: issue.qa_owner ?? null,
      custom_fields: issue.custom_fields ?? null,
    },
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    created_by: "akb-principal",
    ...overrides,
  };
}

export function makeDocumentResponse(overrides: Record<string, unknown> = {}) {
  const path =
    (overrides.path as string | undefined) ??
    "issues/reef-001-fix-the-login-flow.md";
  const vault = (overrides.vault as string | undefined) ?? "reef-sample";
  return {
    uri: `akb://${vault}/doc/${path}`,
    vault,
    path,
    title: "REEF-001 Fix the login flow",
    type: "task",
    status: "draft",
    summary: "Fix the login flow",
    domain: null,
    created_by: "alice",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
    current_commit: "abc1234",
    tags: ["bug", "frontend"],
    content: SAMPLE_BODY,
    is_public: false,
    public_slug: null,
    ...overrides,
  };
}

export function makePutResponse(overrides: Record<string, unknown> = {}) {
  const path =
    (overrides.path as string | undefined) ??
    "issues/reef-001-fix-the-login-flow.md";
  const vault = (overrides.vault as string | undefined) ?? "reef-sample";
  return {
    uri: `akb://${vault}/doc/${path}`,
    vault,
    path,
    commit_hash: "abc1234",
    chunks_indexed: 4,
    entities_found: 1,
    ...overrides,
  };
}
