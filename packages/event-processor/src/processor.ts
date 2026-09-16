import { setTimeout as sleep } from "node:timers/promises";
import {
  AuthError,
  EventTailError,
  NotFoundError,
  SchemaValidationError,
  notificationWakeupForChange,
  type AkbChangeEventTail,
  type AkbNotificationProjectionResult,
  type ChangeEventTailRecord,
} from "@reef/core";

export const DEFAULT_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1_000;

export interface EventProcessorRuntime {
  tail: AkbChangeEventTail;
  projectNotifications: () => Promise<AkbNotificationProjectionResult>;
}

export type EventProcessorTailState =
  | "connecting"
  | "connected"
  | "disconnected";

export type EventProcessorReconciliationOutcome =
  | { status: "success"; result: AkbNotificationProjectionResult }
  | { status: "failure"; error: unknown };

export interface RunEventProcessorOptions {
  vault: string;
  signal?: AbortSignal;
  reconnectDelayMs: number;
  reconciliationIntervalMs?: number;
  onError?: (error: unknown) => void;
  onReady?: () => void;
  onTailState?: (state: EventProcessorTailState) => void;
  onRecoveryChange?: (recovering: boolean) => void;
  onReconciliation?: (outcome: EventProcessorReconciliationOutcome) => void;
}

class NotificationProjectionFailedError extends Error {
  constructor() {
    super("Notification projection did not complete successfully");
    this.name = "NotificationProjectionFailedError";
  }
}

/** Serializes event, gap-recovery, startup, and periodic projection requests. */
class SerialNotificationReconciler {
  private queued: Promise<void> = Promise.resolve();

  constructor(
    private readonly projectNotifications: () => Promise<AkbNotificationProjectionResult>,
    private readonly isStopping: () => boolean,
    private readonly onReconciliation?: (
      outcome: EventProcessorReconciliationOutcome,
    ) => void,
  ) {}

  reconcile(): Promise<void> {
    const current = this.queued.then(async () => {
      if (this.isStopping()) return;
      try {
        const result = await this.projectNotifications();
        if (result.activity.failed || result.comment.failed) {
          throw new NotificationProjectionFailedError();
        }
        this.onReconciliation?.({ status: "success", result });
      } catch (error) {
        this.onReconciliation?.({ status: "failure", error });
        throw error;
      }
    });
    this.queued = current.catch(() => undefined);
    return current;
  }
}

class NotificationProjectionQueue {
  private pendingCursor: string | undefined;
  private pendingWakesProjection = false;
  private worker: Promise<void> | null = null;
  private failure: unknown = null;
  private _committedCursor: string | undefined;

  constructor(
    private readonly vault: string,
    private readonly reconcile: () => Promise<void>,
    private readonly onFailure: () => void,
    private readonly ready: Promise<void>,
    private readonly signal: AbortSignal,
    initialCursor?: string,
  ) {
    this._committedCursor = initialCursor;
  }

  get committedCursor(): string | undefined {
    return this._committedCursor;
  }

  get error(): unknown {
    return this.failure;
  }

  accept(record: ChangeEventTailRecord): void {
    if (this.failure !== null) return;
    this.pendingCursor = record.cursor;
    if (
      record.type === "change" &&
      notificationWakeupForChange(record.event, this.vault) !== null
    ) {
      this.pendingWakesProjection = true;
    }
    if (!this.worker) {
      const worker = Promise.resolve().then(() => this.drain());
      this.worker = worker;
      void worker.catch(() => undefined);
    }
  }

  async finish(): Promise<void> {
    if (this.worker) await this.worker;
    await this.ready;
    if (this.failure !== null) throw this.failure;
  }

  private async drain(): Promise<void> {
    try {
      await this.ready;
      while (this.pendingCursor !== undefined && !this.signal.aborted) {
        const cursor = this.pendingCursor;
        const wakesProjection = this.pendingWakesProjection;
        this.pendingCursor = undefined;
        this.pendingWakesProjection = false;
        if (wakesProjection) await this.reconcile();
        if (this.signal.aborted) return;
        this._committedCursor = cursor;
      }
    } catch (error) {
      this.failure = error;
      this.onFailure();
      throw error;
    } finally {
      this.worker = null;
    }
  }
}

function isAbortError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

function isFatalError(error: unknown): boolean {
  if (error instanceof EventTailError) {
    return error.code !== "upstream" && error.code !== "event_gap";
  }
  return (
    error instanceof AuthError ||
    error instanceof NotFoundError ||
    error instanceof SchemaValidationError
  );
}

async function waitForDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (delayMs === 0 || signal.aborted) return;
  try {
    await sleep(delayMs, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

async function consumeTail(
  runtime: EventProcessorRuntime,
  options: RunEventProcessorOptions,
  signal: AbortSignal,
  lastEventId: string | undefined,
  start: "earliest" | undefined,
  ready: Promise<void>,
  reconcile: () => Promise<void>,
): Promise<string | undefined> {
  const internalController = new AbortController();
  const tailSignal = AbortSignal.any([signal, internalController.signal]);
  void ready.catch(() => internalController.abort());
  const queue = new NotificationProjectionQueue(
    options.vault,
    reconcile,
    () => internalController.abort(),
    ready,
    signal,
    lastEventId,
  );

  options.onTailState?.("connecting");
  try {
    for await (const record of runtime.tail.subscribe({
      vault: options.vault,
      ...(lastEventId ? { lastEventId } : {}),
      ...(start ? { start } : {}),
      signal: tailSignal,
      onOpen: () => options.onTailState?.("connected"),
    })) {
      queue.accept(record);
      if (queue.error !== null) throw queue.error;
      if (signal.aborted) break;
    }
    await queue.finish();
    return queue.committedCursor;
  } catch (error) {
    if (queue.error !== null) throw queue.error;
    if (isAbortError(error, signal) && signal.aborted) {
      return queue.committedCursor;
    }
    throw error;
  } finally {
    internalController.abort();
    options.onTailState?.("disconnected");
  }
}

function validateDelay(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

async function runPeriodicReconciliation(
  reconciler: SerialNotificationReconciler,
  options: RunEventProcessorOptions,
  signal: AbortSignal,
  intervalMs: number,
): Promise<void> {
  while (!signal.aborted) {
    await waitForDelay(intervalMs, signal);
    if (signal.aborted) return;
    try {
      await reconciler.reconcile();
    } catch (error) {
      if (signal.aborted) return;
      if (isFatalError(error)) throw error;
      options.onError?.(error);
    }
  }
}

/** Run one explicit-Vault Event Processor until its signal is aborted. */
export async function runEventProcessor(
  runtime: EventProcessorRuntime,
  options: RunEventProcessorOptions,
): Promise<void> {
  const reconciliationIntervalMs =
    options.reconciliationIntervalMs ?? DEFAULT_RECONCILIATION_INTERVAL_MS;
  validateDelay("reconnectDelayMs", options.reconnectDelayMs);
  validateDelay("reconciliationIntervalMs", reconciliationIntervalMs);
  if (reconciliationIntervalMs === 0) {
    throw new RangeError("reconciliationIntervalMs must be greater than zero");
  }

  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const reconciler = new SerialNotificationReconciler(
    runtime.projectNotifications,
    () => signal.aborted,
    options.onReconciliation,
  );
  let lastEventId: string | undefined;
  let tailStart: "earliest" | undefined;
  let activationPrepared = false;
  let gapRecovery: { latestCursor?: string } | null = null;

  const runTail = async (): Promise<void> => {
    while (!signal.aborted) {
      if (gapRecovery) {
        options.onRecoveryChange?.(true);
        try {
          await reconciler.reconcile();
        } catch (error) {
          if (signal.aborted) return;
          if (isFatalError(error)) throw error;
          options.onError?.(error);
          await waitForDelay(options.reconnectDelayMs, signal);
          continue;
        }

        lastEventId = gapRecovery.latestCursor;
        tailStart = gapRecovery.latestCursor ? undefined : "earliest";
        gapRecovery = null;
        options.onRecoveryChange?.(false);
      }

      const activationReady = Promise.withResolvers<void>();
      const consumeOutcome = consumeTail(
        runtime,
        options,
        signal,
        lastEventId,
        tailStart,
        activationReady.promise,
        () => reconciler.reconcile(),
      ).then(
        (cursor) => ({ status: "closed" as const, cursor }),
        (error: unknown) => ({ status: "failed" as const, error }),
      );

      try {
        if (!activationPrepared) {
          await reconciler.reconcile();
          if (signal.aborted) {
            activationReady.reject(new DOMException("Aborted", "AbortError"));
            await consumeOutcome;
            return;
          }
          activationPrepared = true;
          options.onReady?.();
        }
        activationReady.resolve(undefined);

        const outcome = await consumeOutcome;
        if (signal.aborted) return;
        if (outcome.status === "failed") throw outcome.error;
        lastEventId = outcome.cursor;
        tailStart = undefined;
      } catch (error) {
        activationReady.reject(error);
        await consumeOutcome;
        if (signal.aborted) return;
        if (error instanceof EventTailError && error.code === "event_gap") {
          gapRecovery = { latestCursor: error.context.latestCursor };
          options.onRecoveryChange?.(true);
        } else if (isFatalError(error)) {
          throw error;
        } else {
          options.onError?.(error);
        }
      }

      if (!gapRecovery) {
        await waitForDelay(options.reconnectDelayMs, signal);
      }
    }
  };

  const tailPromise = runTail();
  const periodicPromise = runPeriodicReconciliation(
    reconciler,
    options,
    signal,
    reconciliationIntervalMs,
  );
  try {
    await Promise.race([tailPromise, periodicPromise]);
  } finally {
    controller.abort();
    await Promise.allSettled([tailPromise, periodicPromise]);
  }
}
