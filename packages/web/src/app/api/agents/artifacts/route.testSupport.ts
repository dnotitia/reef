// @vitest-environment node
import { vi } from "vitest";

const {
  mockAllocateNextIssueId,
  mockBuildIssueMetadataFromCreateInput,
  mockVerifyWorkspaceSchema,
  mockGetAkbAdapter,
  mockGetAkbCurrentActor,
  mockListIssues,
  mockReadActivitySuggestion,
  mockReadIssue,
  mockRespondWithError,
  mockUpdateActivitySuggestion,
  mockUpdateActivitySuggestionStatus,
  mockUpdateIssue,
  mockWriteIssue,
} = vi.hoisted(() => ({
  mockAllocateNextIssueId: vi.fn(),
  mockBuildIssueMetadataFromCreateInput: vi.fn(),
  mockVerifyWorkspaceSchema: vi.fn(),
  mockGetAkbAdapter: vi.fn(),
  mockGetAkbCurrentActor: vi.fn(),
  mockListIssues: vi.fn(),
  mockReadActivitySuggestion: vi.fn(),
  mockReadIssue: vi.fn(),
  mockRespondWithError: vi.fn(),
  mockUpdateActivitySuggestion: vi.fn(),
  mockUpdateActivitySuggestionStatus: vi.fn(),
  mockUpdateIssue: vi.fn(),
  mockWriteIssue: vi.fn(),
}));

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    akbAllocateNextIssueId: mockAllocateNextIssueId,
    akbVerifyWorkspaceSchema: mockVerifyWorkspaceSchema,
    akbListIssues: mockListIssues,
    akbReadActivitySuggestion: mockReadActivitySuggestion,
    akbReadIssue: mockReadIssue,
    akbUpdateActivitySuggestion: mockUpdateActivitySuggestion,
    akbUpdateActivitySuggestionStatus: mockUpdateActivitySuggestionStatus,
    akbUpdateIssue: mockUpdateIssue,
    akbWriteIssue: mockWriteIssue,
    buildIssueMetadataFromCreateInput: mockBuildIssueMetadataFromCreateInput,
  };
});

vi.mock("@/lib/api/requestHelpers", () => ({
  getAkbAdapter: mockGetAkbAdapter,
  getAkbCurrentActor: mockGetAkbCurrentActor,
  respondWithError: mockRespondWithError,
}));

export const issueDraftFields = {
  title: "Create unified route",
  issue_type: "task",
  priority: null,
  assigned_to: null,
  requester: null,
  reporter: null,
  start_date: null,
  due_date: null,
  milestone_id: null,
  sprint_id: null,
  release_id: null,
  estimate_points: null,
  severity: null,
  parent_id: null,
  labels: [],
  depends_on: [],
  blocks: [],
  related_to: [],
  external_refs: [],
};

export const chatArtifact = {
  artifact_id: "artifact-1",
  run_id: "chat.workspace:run",
  task_id: "chat.workspace",
  type: "chat_message",
  status: "pending",
  title: null,
  confidence: null,
  reasoning: null,
  evidence: [],
  warnings: [],
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: null,
  metadata: {},
  payload: {
    message_id: "message-1",
    role: "assistant",
    text: "Done",
    parts: [],
  },
};

export const createIssueArtifact = {
  artifact_id: "artifact-create",
  run_id: "activity.draft:run",
  task_id: "activity.draft",
  type: "issue_create_proposal",
  status: "pending",
  title: "Create unified route",
  confidence: 0.8,
  reasoning: "Activity suggests a new task.",
  evidence: [],
  warnings: [],
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: null,
  metadata: {},
  payload: {
    proposal: {
      operation: "create",
      create: {
        fields: issueDraftFields,
        content: "Implement the unified route.",
      },
    },
  },
};

export const updateIssueArtifact = {
  artifact_id: "artifact-update",
  run_id: "activity.update:run",
  task_id: "activity.update",
  type: "issue_update_proposal",
  status: "pending",
  title: "Update unified route",
  confidence: 0.9,
  reasoning: "The issue title should be clearer.",
  evidence: [],
  warnings: [],
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: null,
  metadata: {},
  payload: {
    proposal: {
      operation: "update",
      update: {
        issue_id: "REEF-043",
        patch: { title: "Updated unified route" },
        content: "Updated body",
      },
    },
  },
};

export const statusChangeArtifact = {
  artifact_id: "artifact-status",
  run_id: "activity.status-change:run",
  task_id: "activity.status-change",
  type: "status_change_proposal",
  status: "pending",
  title: "Unified route",
  confidence: 0.84,
  reasoning: "A PR is ready for review.",
  evidence: [],
  warnings: [],
  created_at: "2026-06-04T00:00:00.000Z",
  updated_at: null,
  metadata: {},
  payload: {
    proposal: {
      operation: "update",
      update: {
        issue_id: "REEF-043",
        patch: { status: "in_review" },
      },
    },
    from_status: "in_progress",
    to_status: "in_review",
    rationale: "A PR is ready for review.",
    status_evidence: [
      {
        type: "pr",
        ref: "123",
        repo: "acme/reef",
        actor: "alice",
      },
    ],
  },
};

export const paramsFor = (id: string) => Promise.resolve({ id });

export function request(body: unknown = {}) {
  return new Request("http://localhost/api/agents/artifacts/artifact-1", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function APPROVE(request: Request, context: RouteContext) {
  const route = await import("./[id]/approve/route");
  return route.POST(request, context);
}

export async function DISMISS(request: Request, context: RouteContext) {
  const route = await import("./[id]/dismiss/route");
  return route.POST(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  const route = await import("./[id]/route");
  return route.PATCH(request, context);
}

export {
  mockAllocateNextIssueId,
  mockBuildIssueMetadataFromCreateInput,
  mockVerifyWorkspaceSchema,
  mockGetAkbAdapter,
  mockGetAkbCurrentActor,
  mockListIssues,
  mockReadActivitySuggestion,
  mockReadIssue,
  mockRespondWithError,
  mockUpdateActivitySuggestion,
  mockUpdateActivitySuggestionStatus,
  mockUpdateIssue,
  mockWriteIssue,
};

export function resetArtifactRouteMocks() {
  vi.clearAllMocks();
  mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
  mockGetAkbCurrentActor.mockResolvedValue({ actor: "alice" });
  mockRespondWithError.mockReturnValue(
    Response.json({ error: "Workspace backend error." }, { status: 502 }),
  );
  mockVerifyWorkspaceSchema.mockResolvedValue(undefined);
  mockAllocateNextIssueId.mockResolvedValue("REEF-099");
  mockListIssues.mockResolvedValue({ issues: [] });
  mockReadActivitySuggestion.mockRejectedValue(
    new (class extends Error {
      name = "NotFoundError";
    })(),
  );
  mockBuildIssueMetadataFromCreateInput.mockReturnValue({
    id: "REEF-099",
    title: "Create unified route",
  });
  mockWriteIssue.mockResolvedValue({
    path: "issues/reef-099.md",
    commit_hash: "abc123",
  });
  mockUpdateIssue.mockResolvedValue({
    commit_hash: "def456",
    issue: { id: "REEF-043", title: "Updated unified route" },
  });
  mockReadIssue.mockResolvedValue({
    issue: { id: "REEF-043", status: "todo", source: "manual" },
    content: "Issue body",
  });
  mockUpdateActivitySuggestion.mockResolvedValue({
    suggestion: { id: "reef-draft-1111111111111111", status: "pending" },
  });
  mockUpdateActivitySuggestionStatus.mockResolvedValue({
    suggestion: { id: "reef-draft-1111111111111111", status: "approved" },
  });
}
