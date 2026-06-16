// @vitest-environment node
import { vi } from "vitest";

const {
  mockCreateGitHubAdapter,
  mockCreateLlmAdapter,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  mockEnsureReefTables,
  mockGetAkbAdapter,
  mockListActivitySuggestions,
  mockReadAuthoringLanguage,
  mockScanActivity,
  mockWriteActivitySuggestion,
} = vi.hoisted(() => ({
  mockCreateGitHubAdapter: vi.fn(),
  mockCreateLlmAdapter: vi.fn(),
  mockCreateWorkspaceChatAgentResponse: vi.fn(),
  mockEnrichIssue: vi.fn(),
  mockEnsureReefTables: vi.fn(),
  mockGetAkbAdapter: vi.fn(),
  mockListActivitySuggestions: vi.fn(),
  mockReadAuthoringLanguage: vi.fn(),
  mockScanActivity: vi.fn(),
  mockWriteActivitySuggestion: vi.fn(),
}));

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    akbEnsureReefTables: mockEnsureReefTables,
    akbListActivitySuggestions: mockListActivitySuggestions,
    akbReadAuthoringLanguage: mockReadAuthoringLanguage,
    akbWriteActivitySuggestion: mockWriteActivitySuggestion,
    createGitHubAdapter: mockCreateGitHubAdapter,
    createLlmAdapter: mockCreateLlmAdapter,
    createWorkspaceChatAgentResponse: mockCreateWorkspaceChatAgentResponse,
    enrichIssue: mockEnrichIssue,
    scanActivity: mockScanActivity,
  };
});

vi.mock("@/lib/api/requestHelpers", () => ({
  getAkbAdapter: mockGetAkbAdapter,
}));

import { VAULT_HEADER } from "@/lib/akb/headers";
import type { AgentRunEvent } from "@reef/core";

export const message = {
  id: "m-1",
  role: "user" as const,
  parts: [{ type: "text", text: "Show project status" }],
};

export const issueDraftFields = {
  title: "Fix login bug",
  issue_type: "bug",
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

export const chatRunBody = {
  task_id: "chat.workspace",
  input: { messages: [message] },
};

export const enrichmentRunBody = {
  task_id: "issue.enrichment",
  input: {
    issueId: "REEF-043",
    vault: "reef-test",
    draft: {
      fields: issueDraftFields,
      content: "Users cannot log in after token expiry.",
    },
    repoContext: { owner: "acme", repo: "reef" },
  },
};

export const activityRunBody = {
  task_id: "activity.scan",
  input: {
    owner: "acme",
    repo: "reef",
    vault: "reef-test",
    projectPrefix: "REEF",
  },
};

export function makeRequest(
  body: unknown,
  headers: Record<string, string | null> = {},
  init: Pick<RequestInit, "signal"> = {},
) {
  const mergedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: "Bearer ghp_test",
    [VAULT_HEADER]: "reef-test",
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete mergedHeaders[key];
    else mergedHeaders[key] = value;
  }

  return new Request("http://localhost/api/agents/runs", {
    method: "POST",
    body: JSON.stringify(body),
    headers: mergedHeaders,
    ...init,
  });
}

export function runStarted(taskId: string): AgentRunEvent {
  return {
    event_id: `${taskId}:started`,
    run_id: `${taskId}:run`,
    task_id: taskId,
    seq: 0,
    created_at: "2026-06-04T00:00:00.000Z",
    type: "run.started",
    run_status: "running",
    input: {},
    metadata: {},
  };
}

export function runCompleted(taskId: string): AgentRunEvent {
  return {
    event_id: `${taskId}:completed`,
    run_id: `${taskId}:run`,
    task_id: taskId,
    seq: 1,
    created_at: "2026-06-04T00:00:01.000Z",
    type: "run.completed",
    run_status: "completed",
    artifact_ids: [],
    usage: {},
    metadata: {},
  };
}

export function runError(taskId: string): AgentRunEvent {
  return {
    event_id: `${taskId}:error`,
    run_id: `${taskId}:run`,
    task_id: taskId,
    seq: 1,
    created_at: "2026-06-04T00:00:01.000Z",
    type: "run.error",
    run_status: "error",
    error: {
      code: "agent_failed",
      message: "Agent failed.",
      recoverable: false,
      details: {},
    },
    metadata: {},
  };
}

export function childArtifactFinal(): AgentRunEvent {
  return {
    event_id: "activity.draft:artifact",
    run_id: "activity.draft:run",
    task_id: "activity.draft",
    seq: 1,
    created_at: "2026-06-04T00:00:01.000Z",
    type: "artifact.final",
    artifact: {
      artifact_id: "artifact-draft-1",
      run_id: "activity.draft:run",
      task_id: "activity.draft",
      type: "chat_message",
      status: "pending",
      title: null,
      confidence: null,
      reasoning: null,
      evidence: [],
      warnings: [],
      created_at: "2026-06-04T00:00:01.000Z",
      updated_at: null,
      metadata: {},
      payload: {
        message_id: "message-1",
        role: "assistant",
        text: "Draft created.",
        parts: [],
      },
    },
    metadata: {},
  };
}

export function parseSseEvents(text: string): AgentRunEvent[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const dataLine = frame
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) throw new Error(`Missing data line: ${frame}`);
      return JSON.parse(dataLine.slice("data: ".length)) as AgentRunEvent;
    });
}

export function makeUiMessageStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  );
}

export {
  mockCreateGitHubAdapter,
  mockCreateLlmAdapter,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  mockEnsureReefTables,
  mockGetAkbAdapter,
  mockListActivitySuggestions,
  mockReadAuthoringLanguage,
  mockScanActivity,
  mockWriteActivitySuggestion,
};

export async function POST(request: Request) {
  const route = await import("./route");
  return route.POST(request);
}

export function resetAgentRunsRouteMocks() {
  vi.clearAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test");
  vi.stubEnv("OPENROUTER_BASE_URL", "https://api.openai.com/v1");
  vi.stubEnv("REEF_LLM_MODEL", "gpt-4o");
  mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
  mockCreateGitHubAdapter.mockReturnValue({});
  mockCreateLlmAdapter.mockReturnValue({ model: vi.fn() });
  mockEnsureReefTables.mockResolvedValue(undefined);
  mockListActivitySuggestions.mockResolvedValue({ suggestions: [] });
  mockReadAuthoringLanguage.mockResolvedValue(null);
  mockWriteActivitySuggestion.mockResolvedValue({
    path: "_reef/activity-inbox/reef-draft-test.md",
    commit_hash: "abc123",
  });
  mockCreateWorkspaceChatAgentResponse.mockImplementation(
    async (params: {
      onEvent?: (event: AgentRunEvent) => void;
    }) => {
      params.onEvent?.(runStarted("chat.workspace"));
      params.onEvent?.(runCompleted("chat.workspace"));
      return makeUiMessageStreamResponse([
        'data: {"type":"text-start","id":"text-1"}\n\n',
        'data: {"type":"text-delta","id":"text-1","delta":"Hello ',
        'world"}\n\ndata: {"type":"text-end","id":"text-1"}\n\n',
        "data: [DONE]\n\n",
      ]);
    },
  );
  mockEnrichIssue.mockImplementation(
    async (params: {
      onEvent?: (event: AgentRunEvent) => Promise<void> | void;
    }) => {
      await params.onEvent?.(runStarted("issue.enrichment"));
      await params.onEvent?.(runCompleted("issue.enrichment"));
    },
  );
  mockScanActivity.mockResolvedValue({ drafts: [], statusChanges: [] });
}

export function cleanupAgentRunsRouteMocks() {
  vi.unstubAllEnvs();
}
