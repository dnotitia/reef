import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AkbAdapter } from "../adapters/akb";
import type { GitHubAdapter } from "../adapters/github";
import type { LlmAdapter } from "../adapters/llm";
import {
  type WorkspaceChatStepSummary,
  createWorkspaceChatAgentResponse,
  getWorkspaceChatTaskConfig,
} from "./chatAgent";
import type { AgentRunEvent } from "./framework/events";

const {
  ToolLoopAgentMock,
  createAgentUIStreamResponseMock,
  stepCountIsMock,
  readConfigMock,
} = vi.hoisted(() => ({
  ToolLoopAgentMock: vi.fn(function ToolLoopAgentMock(
    this: { settings?: unknown },
    settings: unknown,
  ) {
    this.settings = settings;
  }),
  createAgentUIStreamResponseMock: vi.fn(),
  stepCountIsMock: vi.fn((steps: number) => ({ steps })),
  readConfigMock: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    ToolLoopAgent: ToolLoopAgentMock,
    createAgentUIStreamResponse: createAgentUIStreamResponseMock,
    stepCountIs: stepCountIsMock,
  };
});

// The chat agent reads monitored_repos to scope the unbound repo tools
// (REEF-243); mock the config read so tool assembly is deterministic.
vi.mock("../adapters/akb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adapters/akb")>();
  return { ...actual, readConfig: readConfigMock };
});

const message = {
  id: "message-1",
  role: "user" as const,
  parts: [{ type: "text" as const, text: "What changed?" }],
};

const baseParams = () => ({
  adapter: { request: vi.fn() } as unknown as AkbAdapter,
  githubAdapter: {} as GitHubAdapter,
  vault: "reef-test",
  llmAdapter: {
    model: vi.fn(() => ({ id: "test-model" })),
  } as unknown as LlmAdapter,
  messages: [message],
});

const createParams = (
  overrides: Partial<ReturnType<typeof baseParams>> = {},
) => ({
  ...baseParams(),
  ...overrides,
});

const getAgentSettings = () =>
  ToolLoopAgentMock.mock.calls[0]?.[0] as {
    experimental_telemetry: { isEnabled: boolean; functionId: string };
    onFinish: () => void;
    onStepFinish: (stepResult: {
      finishReason: string;
      toolCalls: Array<{ toolName?: string } | null>;
    }) => void;
    stopWhen: unknown;
    tools: Record<string, unknown>;
  };

describe("workspace chat agent task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentUIStreamResponseMock.mockResolvedValue(new Response("ok"));
    // Default: one monitored repo so the unbound chat repo tools are wired.
    readConfigMock.mockResolvedValue({
      config: {
        monitored_repos: [{ github_id: 1, owner: "acme", name: "platform" }],
      },
      exists: true,
    });
  });

  it("declares chat.workspace streaming config in the registry", () => {
    expect(getWorkspaceChatTaskConfig()).toMatchObject({
      taskId: "chat.workspace",
      executionMode: "tool-loop-stream",
      functionId: "reef.agent.chat.workspace",
      maxSteps: 10,
      toolsetPolicy: ["workspace-read", "repo-read"],
    });
  });

  it("assembles the AI SDK stream presenter from registry config", async () => {
    const params = createParams();

    await createWorkspaceChatAgentResponse(params);

    expect(stepCountIsMock).toHaveBeenCalledWith(10);
    const settings = getAgentSettings();
    expect(settings.experimental_telemetry).toEqual({
      isEnabled: true,
      functionId: "reef.agent.chat.workspace",
    });
    expect(Object.keys(settings.tools).sort()).toEqual([
      "dev_read_file",
      "list_assignees",
      "read_issue",
      "search_code",
      "search_issues",
    ]);

    expect(createAgentUIStreamResponseMock).toHaveBeenCalledTimes(1);
    const responseOptions = createAgentUIStreamResponseMock.mock.calls[0]?.[0];
    expect(responseOptions).toEqual(
      expect.objectContaining({
        uiMessages: params.messages,
        originalMessages: params.messages,
      }),
    );
  });

  it("omits repo tools when GitHub grounding is unavailable", async () => {
    await createWorkspaceChatAgentResponse({
      ...createParams(),
      githubAdapter: undefined,
    });

    expect(Object.keys(getAgentSettings().tools).sort()).toEqual([
      "list_assignees",
      "read_issue",
      "search_issues",
    ]);
    // No GitHub grounding → the monitored-repo read is skipped entirely.
    expect(readConfigMock).not.toHaveBeenCalled();
  });

  it("omits repo tools when the vault monitors no repositories (REEF-243)", async () => {
    readConfigMock.mockResolvedValueOnce({
      config: { monitored_repos: [] },
      exists: true,
    });

    await createWorkspaceChatAgentResponse(createParams());

    // GitHub is connected, but with no monitored repos there is nothing the
    // unbound tools may safely read, so no repo tools are wired.
    expect(Object.keys(getAgentSettings().tools).sort()).toEqual([
      "list_assignees",
      "read_issue",
      "search_issues",
    ]);
  });

  it("degrades to AKB-only when the monitored-repo read fails (REEF-243)", async () => {
    readConfigMock.mockRejectedValueOnce(new Error("akb unreachable"));

    await createWorkspaceChatAgentResponse(createParams());

    // A config-read failure should not break chat or expose an unbounded read —
    // it drops repo grounding and proceeds AKB scoped.
    expect(Object.keys(getAgentSettings().tools).sort()).toEqual([
      "list_assignees",
      "read_issue",
      "search_issues",
    ]);
  });

  it("reports step summaries and common run lifecycle events", async () => {
    const events: AgentRunEvent[] = [];
    const steps: WorkspaceChatStepSummary[] = [];

    await createWorkspaceChatAgentResponse({
      ...createParams(),
      onEvent: (event) => events.push(event),
      onStepFinish: (step) => steps.push(step),
    });

    const settings = getAgentSettings();
    settings.onStepFinish({
      finishReason: "tool-calls",
      toolCalls: [
        { toolName: "search_issues" },
        null,
        { toolName: "dev_read_file" },
      ],
    });
    settings.onFinish();

    expect(steps).toEqual([
      {
        stepIndex: 0,
        finishReason: "tool-calls",
        toolNames: ["search_issues", "dev_read_file"],
      },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.completed",
    ]);
  });

  it("emits run.error when the UIMessage presenter reports a stream error", async () => {
    const events: AgentRunEvent[] = [];

    await createWorkspaceChatAgentResponse({
      ...createParams(),
      onEvent: (event) => events.push(event),
      onError: () => "handled",
    });

    const responseOptions = createAgentUIStreamResponseMock.mock
      .calls[0]?.[0] as {
      onError: (error: unknown) => string;
    };

    expect(responseOptions.onError(new Error("boom"))).toBe("handled");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.error",
    ]);
    const errorEvent = events.at(-1);
    expect(errorEvent).toMatchObject({
      type: "run.error",
      error: { code: "workspace_chat_stream_error", message: "boom" },
    });
  });
});
