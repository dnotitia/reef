/**
 * Shared Storybook fixtures for apps/web stories.
 * Types are inferred from Zod schemas in @reef/core — no inline `any` types.
 */
import type { Collaborator, IssueDocument, IssueMetadata } from "@reef/core";

/** Fixtures used by AssigneeCombobox stories. */
export const mockCollaborators: Collaborator[] = [
  {
    login: "alice",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    name: "Alice Kim",
  },
  {
    login: "bob",
    avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
    name: "Bob Park",
  },
  {
    login: "carol",
    avatar_url: null,
    name: null,
  },
];

/** Fixtures used by board/Kanban stories. */
export const mockIssues: IssueMetadata[] = [
  {
    id: "reef-001",
    title: "Set up project authentication",
    status: "todo",
    priority: "high",
    created_at: "2026-04-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-01T00:00:00.000Z",
    updated_by: "alice",
    assigned_to: "alice",
  },
  {
    id: "reef-002",
    title: "Build Kanban board component",
    status: "in_progress",
    priority: "medium",
    created_at: "2026-04-02T00:00:00.000Z",
    created_by: "bob",
    updated_at: "2026-04-10T00:00:00.000Z",
    updated_by: "bob",
  },
  {
    id: "reef-003",
    title: "Add GitHub OAuth flow",
    status: "in_review",
    priority: "high",
    created_at: "2026-04-03T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-11T00:00:00.000Z",
    updated_by: "carol",
    assigned_to: "carol",
  },
  {
    id: "reef-004",
    title: "Write unit tests for core models",
    status: "done",
    priority: "low",
    created_at: "2026-04-04T00:00:00.000Z",
    created_by: "bob",
    updated_at: "2026-04-09T00:00:00.000Z",
    updated_by: "bob",
  },
  {
    id: "reef-005",
    title: "Migrate config to IndexedDB",
    status: "closed",
    priority: "medium",
    created_at: "2026-04-05T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-08T00:00:00.000Z",
    updated_by: "alice",
  },
  {
    id: "reef-006",
    title: "Implement drag-and-drop status transitions",
    status: "todo",
    priority: "critical",
    created_at: "2026-04-06T00:00:00.000Z",
    created_by: "carol",
    updated_at: "2026-04-12T00:00:00.000Z",
    updated_by: "carol",
    assigned_to: "carol",
  },
];

/**
 * Fixture for issue detail stories. Shape mirrors the akb-backed GET response
 * `{ issue, content }` (no `sha` after the akb pivot — LWW, no CAS).
 */
export const mockIssueDetail: IssueDocument = {
  issue: {
    id: "REEF-010",
    title: "Implement vault-backed issue editing",
    status: "in_progress",
    priority: "high",
    assigned_to: "alice",
    labels: ["ui", "akb-pivot"],
    created_at: "2026-04-10T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-13T00:00:00.000Z",
    updated_by: "alice",
  },
  content: "## Notes\n\nEdit me.",
};

/** Fixture used by issue list / search / filter stories. */
export const mockIssueList: IssueMetadata[] = [
  {
    id: "REEF-001",
    title: "Set up pnpm workspace monorepo",
    status: "done",
    priority: "high",
    created_at: "2026-04-01T00:00:00.000Z",
    created_by: "minsu",
    updated_at: "2026-04-02T00:00:00.000Z",
    updated_by: "minsu",
    assigned_to: "minsu",
    labels: ["infra", "setup"],
  },
  {
    id: "REEF-002",
    title: "Implement GitHub OAuth login flow",
    status: "todo",
    priority: "critical",
    created_at: "2026-04-02T00:00:00.000Z",
    created_by: "jieun",
    updated_at: "2026-04-05T00:00:00.000Z",
    updated_by: "jieun",
    assigned_to: "jieun",
    labels: ["auth", "security"],
    depends_on: ["REEF-001"],
  },
  {
    id: "REEF-003",
    title: "Build issue list view with sorting and filtering",
    status: "in_progress",
    priority: "high",
    created_at: "2026-04-03T00:00:00.000Z",
    created_by: "minsu",
    updated_at: "2026-04-06T00:00:00.000Z",
    updated_by: "minsu",
    assigned_to: "minsu",
    labels: ["ui", "list-view"],
    depends_on: ["REEF-002"],
  },
  {
    id: "REEF-004",
    title: "Write project documentation",
    status: "todo",
    priority: "low",
    created_at: "2026-04-04T00:00:00.000Z",
    created_by: "jieun",
    updated_at: "2026-04-04T00:00:00.000Z",
    updated_by: "jieun",
    labels: ["docs"],
  },
  {
    id: "REEF-005",
    title: "Performance profiling and optimization",
    status: "in_review",
    priority: "medium",
    created_at: "2026-04-05T00:00:00.000Z",
    created_by: "minsu",
    updated_at: "2026-04-07T00:00:00.000Z",
    updated_by: "minsu",
    assigned_to: "minsu",
    labels: ["perf"],
  },
];
