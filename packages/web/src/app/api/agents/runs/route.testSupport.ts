// @vitest-environment node
import { vi } from "vitest";

const {
  mockCreateGitHubAdapter,
  mockCreateGitHubAppInstallationTokenProvider,
  mockCreateLlmAdapter,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  mockGetAkbAdapter,
  mockGetAkbCurrentActor,
  mockReadAuthoringLanguage,
} = vi.hoisted(() => ({
  mockCreateGitHubAdapter: vi.fn(),
  mockCreateGitHubAppInstallationTokenProvider: vi.fn(),
  mockCreateLlmAdapter: vi.fn(),
  mockCreateWorkspaceChatAgentResponse: vi.fn(),
  mockEnrichIssue: vi.fn(),
  mockGetAkbAdapter: vi.fn(),
  mockGetAkbCurrentActor: vi.fn(),
  mockReadAuthoringLanguage: vi.fn(),
}));

vi.mock("@reef/core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@reef/core")>();
  return {
    ...original,
    akbReadAuthoringLanguage: mockReadAuthoringLanguage,
  };
});

vi.mock("@/server/application/agents", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/application/agents")>();
  return {
    ...original,
    createWorkspaceChatAgentResponse: mockCreateWorkspaceChatAgentResponse,
    enrichIssue: mockEnrichIssue,
  };
});

vi.mock("@/server/adapters/githubAdapter", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/adapters/githubAdapter")>();
  return { ...original, createGitHubAdapter: mockCreateGitHubAdapter };
});

vi.mock("@/server/adapters/github/appAuth", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/adapters/github/appAuth")>();
  return {
    ...original,
    createGitHubAppInstallationTokenProvider:
      mockCreateGitHubAppInstallationTokenProvider,
  };
});

vi.mock("@/server/adapters/llmAdapter", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/adapters/llmAdapter")>();
  return { ...original, createLlmAdapter: mockCreateLlmAdapter };
});

vi.mock("@/lib/api/requestHelpers", () => ({
  getAkbAdapter: mockGetAkbAdapter,
  getAkbCurrentActor: mockGetAkbCurrentActor,
}));

// Deployment GitHub App config - default configured in reset so route tests
// exercise the REEF-244 server-managed credential path. Flip
// `appConfigState.current` to exercise unavailable deployments.
export type ServerAppConfig =
  | {
      ok: true;
      config: { app_id: string; installation_id: string; private_key: string };
      status: { isConfigured: true; appId: string };
    }
  | {
      ok: false;
      status: { isConfigured: false; appId: string | null };
      issues: string[];
    };

export const NOT_CONFIGURED: ServerAppConfig = {
  ok: false,
  status: { isConfigured: false, appId: null },
  issues: ["app_id is required"],
};

// `satisfies` (not a `: ServerAppConfig` annotation) so the exported type keeps
// the `ok: true` branch — importers can read `APP_CONFIG.config` without the
// union widening it back to "maybe not configured".
export const APP_CONFIG = {
  ok: true,
  config: {
    app_id: "123456",
    installation_id: "789",
    private_key:
      "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----",
  },
  status: { isConfigured: true, appId: "123456" },
} satisfies ServerAppConfig;

// Not exported directly: a `vi.hoisted` binding is not yet re-exported. Tests
// flip the config through `setServerAppConfig`.
const appConfigState = vi.hoisted(() => ({
  current: undefined as unknown,
}));

vi.mock("@/server/adapters/githubCredentials/serverAppConfig", () => ({
  resolveServerGitHubAppConfig: () => appConfigState.current,
}));

/** Override the deployment GitHub App config the route resolver sees. */
export function setServerAppConfig(config: ServerAppConfig): void {
  appConfigState.current = config;
}

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

export function makeRequest(
  body: unknown,
  headers: Record<string, string | null> = {},
  init: Pick<RequestInit, "signal"> = {},
) {
  const mergedHeaders: Record<string, string> = {
    "Content-Type": "application/json",
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
  mockCreateGitHubAppInstallationTokenProvider,
  mockCreateLlmAdapter,
  mockCreateWorkspaceChatAgentResponse,
  mockEnrichIssue,
  mockGetAkbAdapter,
  mockGetAkbCurrentActor,
  mockReadAuthoringLanguage,
};

export async function POST(request: Request) {
  const route = await import("./route");
  return route.POST(request);
}

export function resetAgentRunsRouteMocks() {
  vi.clearAllMocks();
  vi.stubEnv("REEF_LLM_API_KEY", "sk-test");
  vi.stubEnv("REEF_LLM_BASE_URL", "https://api.openai.com/v1");
  vi.stubEnv("REEF_LLM_MODEL", "gpt-4o");
  appConfigState.current = APP_CONFIG;
  mockGetAkbAdapter.mockReturnValue({ adapter: { request: vi.fn() } });
  mockGetAkbCurrentActor.mockResolvedValue({ actor: "alice" });
  mockCreateGitHubAdapter.mockReturnValue({});
  mockCreateGitHubAppInstallationTokenProvider.mockReturnValue(
    vi.fn(async () => "ghs_test_installation_token"),
  );
  mockCreateLlmAdapter.mockReturnValue({ model: vi.fn() });
  mockReadAuthoringLanguage.mockResolvedValue(null);
  mockCreateWorkspaceChatAgentResponse.mockImplementation(
    async (params: { onEvent?: (event: AgentRunEvent) => void }) => {
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
}

export function cleanupAgentRunsRouteMocks() {
  vi.unstubAllEnvs();
}
