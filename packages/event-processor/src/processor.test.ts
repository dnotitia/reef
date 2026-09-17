import {
  AuthError,
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
  streams: Array<readonly ChangeEventTailRecord[] | Error>,
  projectNotifications: () => Promise<AkbNotificationProjectionResult>,
  onSubscribe: (input: {
    lastEventId: string | undefined;
    start: "earliest" | undefined;
  }) => void,
): EventProcessorRuntime {
  let streamIndex = 0;
  return {
    projectNotifications,
    tail: {
      async *subscribe({ lastEventId, start, signal }) {
        onSubscribe({ lastEventId, start });
        const records =
          streams[Math.min(streamIndex++, streams.length - 1)] ?? [];
        if (records instanceof Error) throw records;
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

  it("coalesces a burst into serialized reconciliation after activation", async () => {
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
      ({ lastEventId }) => subscribedCursors.push(lastEventId),
    );

    await runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
    });

    expect(project).toHaveBeenCalledTimes(2);
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
      ({ lastEventId }) => subscribedCursors.push(lastEventId),
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
      ({ lastEventId }) => {
        subscribedCursors.push(lastEventId);
        if (lastEventId === "activity-1") controller.abort();
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

  it("reconciles an event gap and resumes after its latest cursor without losing new events", async () => {
    const controller = new AbortController();
    const project = vi.fn(async () => {
      if (project.mock.calls.length === 3) controller.abort();
      return projectionResult();
    });
    const subscriptions: Array<{
      lastEventId: string | undefined;
      start: "earliest" | undefined;
    }> = [];
    const runtime = runtimeWithStreams(
      [
        new EventTailError({
          code: "event_gap",
          status: 410,
          latestCursor: "latest-at-gap",
        }),
        [activityRecord("change-after-reconciliation")],
      ],
      project,
      (input) => subscriptions.push(input),
    );

    await runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
      reconciliationIntervalMs: 60_000,
    });

    expect(project).toHaveBeenCalledTimes(3);
    expect(subscriptions).toEqual([
      { lastEventId: undefined, start: undefined },
      { lastEventId: "latest-at-gap", start: undefined },
    ]);
  });

  it("uses the earliest retained cursor when an event gap lacks a latest cursor", async () => {
    const controller = new AbortController();
    const project = vi.fn(async () => {
      if (project.mock.calls.length === 3) controller.abort();
      return projectionResult();
    });
    const subscriptions: Array<{
      lastEventId: string | undefined;
      start: "earliest" | undefined;
    }> = [];
    const runtime = runtimeWithStreams(
      [
        new EventTailError({ code: "event_gap", status: 410 }),
        [activityRecord("retained-change")],
      ],
      project,
      (input) => subscriptions.push(input),
    );

    await runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
      reconciliationIntervalMs: 60_000,
    });

    expect(project).toHaveBeenCalledTimes(3);
    expect(subscriptions[1]).toEqual({
      lastEventId: undefined,
      start: "earliest",
    });
  });

  it("fails closed for an invalid cursor and authentication failures", async () => {
    for (const error of [
      new EventTailError({ code: "invalid_event_cursor", status: 400 }),
      new AuthError({ origin: "akb", status: 403 }),
    ]) {
      const project = vi.fn(async () => projectionResult());
      const subscribed: Array<string | undefined> = [];
      const runtime = runtimeWithStreams([error], project, ({ lastEventId }) =>
        subscribed.push(lastEventId),
      );

      await expect(
        runEventProcessor(runtime, {
          vault: "reef-sample",
          reconnectDelayMs: 0,
          reconciliationIntervalMs: 60_000,
        }),
      ).rejects.toMatchObject(
        error instanceof EventTailError
          ? { code: "invalid_event_cursor", status: 400 }
          : { name: "AuthError" },
      );
      expect(project).toHaveBeenCalledOnce();
      expect(subscribed).toEqual([undefined]);
    }
  });

  it("runs periodic reconciliation during a quiet tail and serializes it with event work", async () => {
    const controller = new AbortController();
    let active = 0;
    let maxActive = 0;
    const project = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      const call = project.mock.calls.length;
      if (call === 2) await new Promise((resolve) => setTimeout(resolve, 30));
      if (call === 3) controller.abort();
      active -= 1;
      return projectionResult();
    });
    const runtime: EventProcessorRuntime = {
      projectNotifications: project,
      tail: {
        async *subscribe({ signal }) {
          yield activityRecord("activity-while-periodic-pending");
          await new Promise<void>((resolve) => {
            if (signal?.aborted) resolve();
            else
              signal?.addEventListener("abort", () => resolve(), {
                once: true,
              });
          });
        },
      },
    };

    await runEventProcessor(runtime, {
      vault: "reef-sample",
      signal: controller.signal,
      reconnectDelayMs: 0,
      reconciliationIntervalMs: 5,
    });

    expect(project).toHaveBeenCalledTimes(3);
    expect(maxActive).toBe(1);
  });
});
