// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createAgentRunLifecycle } from "./lifecycle";

describe("agent run lifecycle", () => {
  it("sequences validated events and emits only one terminal event", () => {
    const events: string[] = [];
    const lifecycle = createAgentRunLifecycle({
      taskId: "issue.enrichment",
      runId: "run-1",
      now: () => "2026-08-25T00:00:00.000Z",
      onEvent: (event) => events.push(`${event.seq}:${event.type}`),
    });

    lifecycle.start({ issue_id: "REEF-001" });
    lifecycle.emit({
      type: "stage.started",
      stage: { stage_id: "context", name: "context" },
    });
    expect(lifecycle.complete({ artifactIds: ["artifact-1"] })?.type).toBe(
      "run.completed",
    );
    expect(lifecycle.fail(new Error("late"))).toBeNull();
    expect(events).toEqual([
      "0:run.started",
      "1:stage.started",
      "2:run.completed",
    ]);
  });

  it("normalizes failures without exposing thrown values", () => {
    const lifecycle = createAgentRunLifecycle({
      taskId: "chat.workspace",
      runId: "run-2",
    });
    const event = lifecycle.fail(new Error("stream stopped"), "chat_failed");
    expect(event).toMatchObject({
      type: "run.error",
      error: {
        code: "chat_failed",
        message: "stream stopped",
        recoverable: false,
        details: {},
      },
    });
  });
});
