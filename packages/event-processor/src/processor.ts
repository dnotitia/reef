import { setTimeout as sleep } from "node:timers/promises";
import {
  AuthError,
  NotFoundError,
  SchemaValidationError,
  type AkbNotificationProjectionResult,
} from "@reef/core";

export const DEFAULT_RECONCILIATION_INTERVAL_MS = 5_000;

export interface EventProcessorRuntime {
  projectNotifications: () => Promise<AkbNotificationProjectionResult>;
}

export type EventProcessorReconciliationOutcome =
  | { status: "success"; result: AkbNotificationProjectionResult }
  | { status: "failure"; error: unknown };

export interface RunEventProcessorOptions {
  signal?: AbortSignal;
  reconciliationIntervalMs?: number;
  onError?: (error: unknown) => void;
  onReady?: () => void;
  onReconciliation?: (outcome: EventProcessorReconciliationOutcome) => void;
}

class NotificationProjectionFailedError extends Error {
  constructor() {
    super("Notification projection did not complete successfully");
    this.name = "NotificationProjectionFailedError";
  }
}

/** Reconcile durable source cursors without retaining an AKB event stream. */
export async function runEventProcessor(
  runtime: EventProcessorRuntime,
  options: RunEventProcessorOptions,
): Promise<void> {
  const intervalMs =
    options.reconciliationIntervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new RangeError("reconciliationIntervalMs must be a positive integer");
  }
  const signal = options.signal ?? new AbortController().signal;
  let ready = false;
  while (!signal.aborted) {
    try {
      const result = await runtime.projectNotifications();
      if (signal.aborted) return;
      if (result.activity.failed || result.comment.failed)
        throw new NotificationProjectionFailedError();
      options.onReconciliation?.({ status: "success", result });
      if (!ready) {
        ready = true;
        options.onReady?.();
      }
    } catch (error) {
      if (signal.aborted) return;
      options.onReconciliation?.({ status: "failure", error });
      if (
        error instanceof AuthError ||
        error instanceof NotFoundError ||
        error instanceof SchemaValidationError
      )
        throw error;
      options.onError?.(error);
    }
    if (signal.aborted) return;
    try {
      await sleep(intervalMs, undefined, { signal });
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  }
}
