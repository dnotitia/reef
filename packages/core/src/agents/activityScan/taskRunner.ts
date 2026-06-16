import { extractErrorDetail } from "../../utils/extractErrorDetail";
import type { AgentArtifact, AgentRunEvent } from "../framework/events";
import {
  type AgentStageHandlerMap,
  type AgentTaskId,
  createAgentTaskFromRegistry,
} from "../framework/registry";
import { collectAgentResult, runAgentStream } from "../framework/runtime";
import type { ActivityArtifactContext } from "./artifacts";

export type ActivityScanTaskId = Extract<
  AgentTaskId,
  "activity.issue-link" | "activity.draft" | "activity.status-change"
>;

export type ScanActivityEventSink = (
  event: AgentRunEvent,
) => void | Promise<void>;

interface ActivityAgentTaskState<TResult> {
  result: TResult | null;
}

export async function runActivityAgentTask<TResult>({
  taskId,
  execute,
  toArtifact,
  onEvent,
}: {
  taskId: ActivityScanTaskId;
  execute: () => Promise<TResult | null>;
  toArtifact?: (
    result: TResult,
    context: ActivityArtifactContext,
  ) => AgentArtifact | null;
  onEvent?: ScanActivityEventSink;
}): Promise<TResult | null> {
  const state: ActivityAgentTaskState<TResult> = { result: null };
  const stageHandlers: AgentStageHandlerMap<ActivityAgentTaskState<TResult>> = {
    prepareContext: ({ state }) => ({ state }),
    buildPrompt: ({ state }) => ({ state }),
    buildTools: ({ state }) => ({ state }),
    execute: async ({ state }) => {
      state.result = await execute();
      return { state };
    },
    decode: ({ state }) => ({ state }),
    repair: ({ state }) => ({ state }),
    normalize: ({ run_id, state, task_id }) => {
      let artifact: AgentArtifact | null = null;
      let artifactError: string | null = null;
      if (state.result && toArtifact) {
        try {
          artifact = toArtifact(state.result, { run_id, task_id });
        } catch (err) {
          artifactError = extractErrorDetail(err).slice(0, 200);
        }
      }
      return {
        state,
        ...(artifact ? { artifacts: [artifact] } : {}),
        ...(artifactError ? { output: { artifact_error: artifactError } } : {}),
      };
    },
    "present/persist": ({ state }) => ({
      state,
      final_status: state.result ? "completed" : "empty",
    }),
  };
  const task = createAgentTaskFromRegistry(taskId, {
    initial_state: state,
    stageHandlers,
  });
  const envelope = await collectAgentResult(
    tapAgentEvents(runAgentStream(task), onEvent),
  );
  return envelope.status === "error" ? null : state.result;
}

async function* tapAgentEvents(
  events: AsyncIterable<AgentRunEvent>,
  onEvent?: ScanActivityEventSink,
): AsyncGenerator<AgentRunEvent> {
  for await (const event of events) {
    await onEvent?.(event);
    yield event;
  }
}
