import {
  EventTailError,
  type AkbNotificationProjectionResult,
  type ChangeEventTailRecord,
} from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import { runEventProcessor, type EventProcessorRuntime } from "./processor.js";

const projectionResult = (failed = false): AkbNotificationProjectionResult => ({
  activatedAt: "2026-09-01T10:00:00.000Z",
  activated: false,
  activity: {
    scanned: 0,
    fannedOut: 0,
    skippedMalformed: 0,
    skippedNoRecipients: 0,
    cursor: null,
    failed,
  },
  comment: {
    scanned: 0,
    fannedOut: 0,
    skippedMalformed: 0,
    skippedNoRecipients: 0,
    cursor: null,
    failed,
  },
});

const activityRecord = (cursor: string): ChangeEventTailRecord => ({
  type: "change",
  cursor,
  event: {
    version: 1,
    cursor,
    occurred_at: "2026-09-01T10:00:00.000Z",
    vault: "reef-sample",
    kind: "table.rows_changed",
    resource_uri: "akb://reef-sample/table/reef_activity",
    actor: "alice",
    payload: { operation: "insert" },
  },
});

const checkpointRecord = (cursor: string): ChangeEventTailRecord => ({
  type: "checkpoint",
  cursor,
  checkpoint: { version: 1, cursor },
});

function runtimeWithStreams(
  streams: Array<readonly ChangeEventTailRecord[]>,
  projectNotifications: () => Promise<AkbNotificationProjectionResult>,
  onSubscribe: (lastEventId: string | undefined) => void,
): EventProcessorRuntime {
  let streamIndex = 0;
  return {
    projectNotifications,
    tail: {
      async *subscribe({ lastEventId, signal }) {
        onSubscribe(lastEventId);
        const records =
          streams[Math.min(streamIndex++, streams.length - 1)] ?? [];
        for (const record of records) {
          if (signal?.aborted) return;
          yield record;
        }
      },
    },
  };
}

describe("Event Processor", () => {
  it("buffers a connected tail until activation is prepared", async () => {
    const controller = new AbortController();
    let releaseInitial: () => void = () => undefined;
    const initialReady = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    const lifecycle: string[] = [];
    const project = vi.fn(async () => {
      lifecycle.push("project");
      if (project.mock.calls.length === 1) await initialReady;
      if (project.mock.calls.length === 2) controller.abort();
      return projectionResult();
    });
    const runtime = runtimeWithStreams(
      [[activityRecord("activity-during-activation")]],
      project,
      () => lifecycle.push("tail-connected"),
    );

    const running = runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(project).toHaveBeenCalledOnce();
    expect(lifecycle).toEqual(["tail-connected", "project"]);

    releaseInitial();
    await running;
    expect(project).toHaveBeenCalledTimes(2);
  });

  it("keeps burst reconciliation serialized after activation", async () => {
    const controller = new AbortController();
    const project = vi.fn(async () => {
      if (project.mock.calls.length === 2) controller.abort();
      return projectionResult();
    });
    const subscribedCursors: Array<string | undefined> = [];
    const runtime = runtimeWithStreams(
      [
        [
          checkpointRecord("checkpoint-1"),
          activityRecord("activity-1"),
          activityRecord("activity-2"),
        ],
      ],
      project,
      (cursor) => subscribedCursors.push(cursor),
    );

    await runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
    });

    expect(project).toHaveBeenCalledTimes(3);
    expect(project.mock.invocationCallOrder[0]).toBeLessThan(
      project.mock.invocationCallOrder[1] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(subscribedCursors).toEqual([undefined]);
  });

  it("does not commit a cursor when projection returns failed and retries the same event", async () => {
    const controller = new AbortController();
    const project = vi.fn(async () => {
      if (project.mock.calls.length === 3) controller.abort();
      return projectionResult(project.mock.calls.length === 2);
    });
    const subscribedCursors: Array<string | undefined> = [];
    const errors: unknown[] = [];
    const runtime = runtimeWithStreams(
      [[activityRecord("activity-1")], [activityRecord("activity-1")]],
      project,
      (cursor) => subscribedCursors.push(cursor),
    );

    await runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
      onError: (error) => errors.push(error),
    });

    expect(project).toHaveBeenCalledTimes(3);
    expect(subscribedCursors).toEqual([undefined, undefined]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      name: "NotificationProjectionFailedError",
    });
  });

  it("reconnects from the latest successfully projected Event Cursor", async () => {
    const controller = new AbortController();
    const project = vi.fn(async () => projectionResult());
    const subscribedCursors: Array<string | undefined> = [];
    const runtime = runtimeWithStreams(
      [[activityRecord("activity-1")], []],
      project,
      (cursor) => {
        subscribedCursors.push(cursor);
        if (cursor === "activity-1") controller.abort();
      },
    );

    await runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
    });

    expect(project).toHaveBeenCalledTimes(2);
    expect(subscribedCursors).toEqual([undefined, "activity-1"]);
  });

  it("never treats a retained event gap as a reconnectable empty tail", async () => {
    const project = vi.fn(async () => projectionResult());
    const runtime: EventProcessorRuntime = {
      projectNotifications: project,
      tail: {
        async *subscribe() {
          for (const record of [] as ChangeEventTailRecord[]) yield record;
          throw new EventTailError({ code: "event_gap", status: 410 });
        },
      },
    };

    await expect(
      runEventProcessor(runtime, {
        vault: "reef-sample",
        reconnectDelayMs: 0,
      }),
    ).rejects.toMatchObject({ code: "event_gap", status: 410 });
    expect(project).toHaveBeenCalledOnce();
  });
});
