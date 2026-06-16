import { describe, expect, it } from "vitest";
import { SchemaValidationError } from "../../errors";
import {
  AgentTaskRegistryEntrySchema,
  DEFAULT_AGENT_TASK_REGISTRY,
  createAgentTask,
  createAgentTaskFromRegistry,
  getAgentRegistryEntry,
} from "./registry";
import {
  AGENT_PIPELINE_STAGE_IDS,
  collectAgentResult,
  runAgentStream,
} from "./runtime";

const timestamp = "2026-06-04T00:00:00.000Z";

const noopHandlers = Object.fromEntries(
  AGENT_PIPELINE_STAGE_IDS.map((stageId) => [
    stageId,
    () => ({ output: { stageId } }),
  ]),
);

describe("agent task registry", () => {
  it("declares the initial REEF-024 task taxonomy", () => {
    expect(Object.keys(DEFAULT_AGENT_TASK_REGISTRY).sort()).toEqual([
      "activity.draft",
      "activity.issue-link",
      "activity.scan",
      "activity.status-change",
      "chat.workspace",
      "issue.enrichment",
    ]);

    for (const entry of Object.values(DEFAULT_AGENT_TASK_REGISTRY)) {
      expect(AgentTaskRegistryEntrySchema.parse(entry)).toMatchObject({
        taskId: entry.taskId,
        functionId: expect.any(String),
        spanName: expect.any(String),
      });
      expect(entry.stages).toEqual([...AGENT_PIPELINE_STAGE_IDS]);
      expect(entry.toolsetPolicy.length).toBeGreaterThan(0);
    }
  });

  it("builds an executable runtime task from registry config and request context", async () => {
    const task = createAgentTaskFromRegistry("chat.workspace", {
      initial_state: { ready: true },
      stageHandlers: noopHandlers,
      metadata: { vault: "reef-test" },
    });

    expect(task.task_id).toBe("chat.workspace");
    expect(task.metadata).toMatchObject({
      functionId: "reef.agent.chat.workspace",
      spanName: "reef.agent.chat",
      executionMode: "tool-loop-stream",
      vault: "reef-test",
    });

    const envelope = await collectAgentResult(
      runAgentStream(task, { run_id: "run-1", now: () => timestamp }),
    );

    expect(envelope.status).toBe("completed");
    expect(
      envelope.events
        .filter((event) => event.type === "stage.completed")
        .map((event) => event.stage.stage_id),
    ).toEqual([...AGENT_PIPELINE_STAGE_IDS]);
  });

  it("rejects unknown task ids as schema validation errors", () => {
    expect(() => getAgentRegistryEntry("unknown.task")).toThrow(
      SchemaValidationError,
    );
  });

  it("rejects unsupported execution modes", () => {
    const entry = {
      ...DEFAULT_AGENT_TASK_REGISTRY["chat.workspace"],
      executionMode: "custom",
    };

    expect(() =>
      createAgentTask(AgentTaskRegistryEntrySchema.parse(entry), {
        initial_state: {},
        stageHandlers: noopHandlers,
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects missing stage handlers", () => {
    expect(() =>
      createAgentTaskFromRegistry("issue.enrichment", {
        initial_state: {},
        stageHandlers: { execute: () => ({}) },
      }),
    ).toThrow(SchemaValidationError);
  });
});
