import { AuthError, type AkbNotificationProjectionResult } from "@reef/core";
import { describe, expect, it, vi } from "vitest";
import { runEventProcessor } from "./processor.js";

function result(failed = false): AkbNotificationProjectionResult {
  return {
    activatedAt: "2026-11-04T00:00:00.000Z",
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
      failed: false,
    },
  };
}

describe("source reconciliation worker", () => {
  it("waits for source work before readiness and never overlaps reconciliation", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onReady = vi.fn();
    const onReconciliation = vi.fn();
    const project = vi.fn(async () => {
      if (project.mock.calls.length === 1) await pending;
      else controller.abort();
      return result();
    });
    const running = runEventProcessor(
      { projectNotifications: project },
      {
        signal: controller.signal,
        reconciliationIntervalMs: 1,
        onReady,
        onReconciliation,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(project).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    release();
    await running;
    expect(project).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReconciliation).toHaveBeenCalledOnce();
  });

  it.each(["transport", "partial"])(
    "retries %s failures from durable source state",
    async (failure) => {
      const controller = new AbortController();
      const onError = vi.fn();
      const onReconciliation = vi.fn();
      const project = vi.fn(async () => {
        if (project.mock.calls.length === 1) {
          if (failure === "transport") throw new Error("temporary AKB failure");
          return result(true);
        }
        return result();
      });
      const onReady = vi.fn(() => controller.abort());
      await runEventProcessor(
        { projectNotifications: project },
        {
          signal: controller.signal,
          reconciliationIntervalMs: 1,
          onError,
          onReady,
          onReconciliation,
        },
      );
      expect(project).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledOnce();
      expect(onReady).toHaveBeenCalledOnce();
      expect(
        onReconciliation.mock.calls.map(([outcome]) => outcome.status),
      ).toEqual(["failure", "success"]);
    },
  );

  it("stops on an account denial instead of retrying an invalid credential", async () => {
    const denial = new AuthError({ origin: "akb", status: 401 });
    const project = vi.fn().mockRejectedValue(denial);
    const onReconciliation = vi.fn();
    await expect(
      runEventProcessor(
        { projectNotifications: project },
        { onReconciliation },
      ),
    ).rejects.toBe(denial);
    expect(project).toHaveBeenCalledOnce();
    expect(onReconciliation).toHaveBeenCalledWith({
      status: "failure",
      error: denial,
    });
  });

  it("settles an idle worker immediately on shutdown", async () => {
    const controller = new AbortController();
    const project = vi.fn(async () => result());
    const ready = vi.fn();
    const running = runEventProcessor(
      { projectNotifications: project },
      {
        signal: controller.signal,
        reconciliationIntervalMs: 60_000,
        onReady: ready,
      },
    );
    await vi.waitFor(() => expect(ready).toHaveBeenCalledOnce());
    controller.abort();
    await running;
    expect(project).toHaveBeenCalledOnce();
  });

  it("does no work after cancellation", async () => {
    const project = vi.fn();
    await runEventProcessor(
      { projectNotifications: project },
      { signal: AbortSignal.abort() },
    );
    expect(project).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN])(
    "rejects an invalid interval %s",
    async (reconciliationIntervalMs) => {
      const project = vi.fn();
      await expect(
        runEventProcessor(
          { projectNotifications: project },
          { reconciliationIntervalMs },
        ),
      ).rejects.toThrow(RangeError);
      expect(project).not.toHaveBeenCalled();
    },
  );
});
