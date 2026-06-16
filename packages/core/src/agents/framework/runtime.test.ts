import { describe, expect, it } from "vitest";
import type { AgentArtifact } from "./events";
import {
  type AgentTaskDefinition,
  collectAgentResult,
  runAgentStream,
} from "./runtime";

const timestamp = "2026-06-04T00:00:00.000Z";

const makeArtifact = (
  runId: string,
  taskId: string,
  artifactId = "artifact-1",
): AgentArtifact => ({
  artifact_id: artifactId,
  run_id: runId,
  task_id: taskId,
  type: "chat_message",
  status: "pending",
  title: null,
  confidence: null,
  reasoning: null,
  evidence: [],
  warnings: [],
  created_at: timestamp,
  updated_at: null,
  metadata: {},
  payload: {
    message_id: null,
    role: "assistant",
    text: "Runtime complete.",
    parts: [],
  },
});

describe("agent framework runtime", () => {
  it("executes the standard pipeline stages and collects final artifacts", async () => {
    type State = { order: string[] };
    const task: AgentTaskDefinition<State> = {
      task_id: "test.pipeline",
      initial_state: { order: [] },
      stages: [
        {
          stage_id: "prepareContext",
          run: ({ state }) => ({
            state: { order: [...state.order, "prepareContext"] },
          }),
        },
        {
          stage_id: "buildPrompt",
          run: ({ state }) => ({
            state: { order: [...state.order, "buildPrompt"] },
          }),
        },
        {
          stage_id: "buildTools",
          run: ({ state }) => ({
            state: { order: [...state.order, "buildTools"] },
          }),
        },
        {
          stage_id: "execute",
          run: ({ run_id, task_id, state }) => ({
            state: { order: [...state.order, "execute"] },
            artifacts: [makeArtifact(run_id, task_id)],
            usage: { total_tokens: 42 },
            finish_reason: "stop",
          }),
        },
        {
          stage_id: "decode",
          run: ({ state }) => ({
            state: { order: [...state.order, "decode"] },
          }),
        },
        {
          stage_id: "repair",
          run: ({ state }) => ({
            state: { order: [...state.order, "repair"] },
          }),
        },
        {
          stage_id: "normalize",
          run: ({ state }) => ({
            state: { order: [...state.order, "normalize"] },
          }),
        },
        {
          stage_id: "present/persist",
          run: ({ state }) => ({
            state: { order: [...state.order, "present/persist"] },
          }),
        },
      ],
    };

    const envelope = await collectAgentResult(
      runAgentStream(task, { run_id: "run-1", now: () => timestamp }),
    );

    expect(envelope.status).toBe("completed");
    expect(envelope.artifacts).toHaveLength(1);
    expect(envelope.metadata).toMatchObject({
      usage: { total_tokens: 42 },
      finish_reason: "stop",
    });
    expect(
      envelope.events
        .filter((event) => event.type === "stage.completed")
        .map((event) => event.stage.stage_id),
    ).toEqual([
      "prepareContext",
      "buildPrompt",
      "buildTools",
      "execute",
      "decode",
      "repair",
      "normalize",
      "present/persist",
    ]);
  });

  it("streams events emitted by async iterable stages", async () => {
    const task: AgentTaskDefinition<Record<string, never>> = {
      task_id: "test.streaming",
      initial_state: {},
      stages: [
        {
          stage_id: "execute",
          async *run() {
            yield {
              type: "event",
              event: { type: "model.delta", delta: "hello" },
            };
            yield {
              type: "result",
              result: { usage: { completion_tokens: 1 } },
            };
          },
        },
      ],
    };

    const events = [];
    for await (const event of runAgentStream(task, {
      run_id: "run-1",
      now: () => timestamp,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toContain("model.delta");
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      usage: { completion_tokens: 1 },
    });
  });

  it("flushes context.emit events from async iterable stages", async () => {
    const task: AgentTaskDefinition<Record<string, never>> = {
      task_id: "test.emit",
      initial_state: {},
      stages: [
        {
          stage_id: "execute",
          async *run(context) {
            context.emit({ type: "model.delta", delta: "from callback" });
            yield { type: "result", result: {} };
          },
        },
      ],
    };

    const events = [];
    for await (const event of runAgentStream(task, {
      run_id: "run-1",
      now: () => timestamp,
    })) {
      events.push(event);
    }

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "model.delta",
        delta: "from callback",
      }),
    );
  });

  it("tracks artifact ids for streamed final artifact events", async () => {
    const task: AgentTaskDefinition<Record<string, never>> = {
      task_id: "test.artifact-stream",
      initial_state: {},
      stages: [
        {
          stage_id: "execute",
          async *run(context) {
            yield {
              type: "event",
              event: {
                type: "artifact.final",
                artifact: makeArtifact(context.run_id, context.task_id),
                metadata: { trace_id: "trace-1" },
              },
            };
          },
        },
      ],
    };

    const events = [];
    for await (const event of runAgentStream(task, {
      run_id: "run-1",
      now: () => timestamp,
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      artifact_ids: ["artifact-1"],
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "artifact.final",
        metadata: { trace_id: "trace-1" },
      }),
    );
  });

  it("maps stage errors into stage.error and run.error events", async () => {
    const task: AgentTaskDefinition<Record<string, never>> = {
      task_id: "test.error",
      initial_state: {},
      stages: [
        {
          stage_id: "execute",
          run: () => {
            throw new Error("boom");
          },
        },
      ],
    };

    const events = [];
    for await (const event of runAgentStream(task, {
      run_id: "run-1",
      now: () => timestamp,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "stage.started",
      "stage.error",
      "run.error",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "run.error",
      error: { message: "boom" },
    });
  });

  it("uses a schema-safe fallback message for blank errors", async () => {
    const task: AgentTaskDefinition<Record<string, never>> = {
      task_id: "test.blank-error",
      initial_state: {},
      stages: [
        {
          stage_id: "execute",
          run: () => {
            throw new Error("");
          },
        },
      ],
    };

    const envelope = await collectAgentResult(
      runAgentStream(task, { run_id: "run-1", now: () => timestamp }),
    );

    expect(envelope.status).toBe("error");
    expect(envelope.error?.message).toBe("Agent runtime error");
  });

  it("flushes context.emit events before stage.error when a stage fails", async () => {
    const task: AgentTaskDefinition<Record<string, never>> = {
      task_id: "test.emit-before-error",
      initial_state: {},
      stages: [
        {
          stage_id: "repair",
          run: (context) => {
            context.emit({
              type: "repair.failed",
              repair: {
                attempt: 1,
                reason: "invalid json",
                policy: "json-repair",
              },
              error: {
                code: "repair_failed",
                message: "still invalid",
                recoverable: false,
                details: {},
              },
            });
            throw new Error("boom");
          },
        },
      ],
    };

    const events = [];
    for await (const event of runAgentStream(task, {
      run_id: "run-1",
      now: () => timestamp,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "stage.started",
      "repair.failed",
      "stage.error",
      "run.error",
    ]);
  });

  it("handles pre-aborted runs as cancellation events", async () => {
    const controller = new AbortController();
    controller.abort();
    let initialized = false;
    const task: AgentTaskDefinition<Record<string, never>> = {
      task_id: "test.cancel",
      initial_state: () => {
        initialized = true;
        return {};
      },
      stages: [
        {
          stage_id: "execute",
          run: () => ({}),
        },
      ],
    };

    const envelope = await collectAgentResult(
      runAgentStream(task, {
        run_id: "run-1",
        now: () => timestamp,
        signal: controller.signal,
      }),
    );

    expect(envelope.status).toBe("cancelled");
    expect(initialized).toBe(false);
    expect(envelope.events).toEqual([
      expect.objectContaining({ type: "run.cancelled" }),
    ]);
  });
});
