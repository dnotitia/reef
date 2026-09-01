import { setTimeout as sleep } from "node:timers/promises";
import {
  EventTailError,
  notificationWakeupForChange,
  type AkbChangeEventTail,
  type ChangeEventTailRecord,
  type AkbNotificationProjectionResult,
} from "@reef/core";

export interface EventProcessorRuntime {
  tail: AkbChangeEventTail;
  projectNotifications: () => Promise<AkbNotificationProjectionResult>;
}

export interface RunEventProcessorOptions {
  vault: string;
  signal?: AbortSignal;
  reconnectDelayMs: number;
  onError?: (error: unknown) => void;
}

export class NotificationProjectionFailedError extends Error {
  constructor() {
    super("Notification projection did not complete successfully");
    this.name = "NotificationProjectionFailedError";
  }
}

interface PendingRecord {
  record: ChangeEventTailRecord;
  wakesProjection: boolean;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason: unknown) => void = () => undefined;
  return {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

class NotificationReconciliationQueue {
  private readonly pending: PendingRecord[] = [];
  private worker: Promise<void> | null = null;
  private failure: unknown = null;
  private _committedCursor: string | undefined;

  constructor(
    private readonly vault: string,
    private readonly projectNotifications: () => Promise<AkbNotificationProjectionResult>,
    private readonly onFailure: () => void,
    private readonly ready: Promise<void>,
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
    this.pending.push({
      record,
      wakesProjection:
        record.type === "change" &&
        notificationWakeupForChange(record.event, this.vault) !== null,
    });
    if (!this.worker) {
      // Let synchronously delivered SSE frames form one burst before the first
      // projection starts. A later frame arriving while that projection is
      // running remains a separate follow-up batch.
      this.worker = Promise.resolve().then(() => this.drain());
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
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0, this.pending.length);
        if (batch.some((item) => item.wakesProjection)) {
          const result = await this.projectNotifications();
          if (result.activity.failed || result.comment.failed) {
            throw new NotificationProjectionFailedError();
          }
        }
        const last = batch.at(-1);
        if (last) this._committedCursor = last.record.cursor;
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

function isTerminalTailError(error: unknown): boolean {
  if (error instanceof EventTailError) {
    return error.code !== "upstream";
  }
  return false;
}

async function waitForReconnect(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (delayMs === 0 || signal?.aborted) return Promise.resolve();
  try {
    if (signal) await sleep(delayMs, undefined, { signal });
    else await sleep(delayMs);
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
}

function combineSignals(
  externalSignal: AbortSignal | undefined,
  internalController: AbortController,
): { signal: AbortSignal; cleanup: () => void } {
  if (!externalSignal) {
    return { signal: internalController.signal, cleanup: () => undefined };
  }
  return {
    signal: AbortSignal.any([externalSignal, internalController.signal]),
    cleanup: () => undefined,
  };
}

async function consumeTail(
  runtime: EventProcessorRuntime,
  options: RunEventProcessorOptions,
  lastEventId: string | undefined,
  ready: Promise<void>,
): Promise<string | undefined> {
  const internalController = new AbortController();
  const combined = combineSignals(options.signal, internalController);
  void ready.catch(() => internalController.abort());
  const queue = new NotificationReconciliationQueue(
    options.vault,
    runtime.projectNotifications,
    () => internalController.abort(),
    ready,
    lastEventId,
  );

  try {
    for await (const record of runtime.tail.subscribe({
      vault: options.vault,
      ...(lastEventId ? { lastEventId } : {}),
      signal: combined.signal,
    })) {
      queue.accept(record);
      if (queue.error !== null) throw queue.error;
      if (options.signal?.aborted) break;
    }
    await queue.finish();
    return queue.committedCursor;
  } catch (error) {
    if (queue.error !== null) throw queue.error;
    if (isAbortError(error, options.signal)) {
      if (options.signal?.aborted) return queue.committedCursor;
    }
    throw error;
  } finally {
    internalController.abort();
    combined.cleanup();
  }
}

function validateReconnectDelay(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      "reconnectDelayMs must be a non-negative finite number",
    );
  }
}

/** Run one explicit-Vault Event Processor until its signal is aborted. */
export async function runEventProcessor(
  runtime: EventProcessorRuntime,
  options: RunEventProcessorOptions,
): Promise<void> {
  validateReconnectDelay(options.reconnectDelayMs);
  let lastEventId: string | undefined;
  let activationPrepared = false;

  while (!options.signal?.aborted) {
    const activationReady = createDeferred<void>();
    const consumePromise = consumeTail(
      runtime,
      options,
      lastEventId,
      activationReady.promise,
    );
    const observedConsumePromise = consumePromise.catch((error: unknown) => {
      activationReady.reject(error);
      throw error;
    });
    void observedConsumePromise.catch(() => undefined);
    try {
      if (!activationPrepared) {
        const initial = await runtime.projectNotifications();
        if (initial.activity.failed || initial.comment.failed) {
          throw new NotificationProjectionFailedError();
        }
        activationPrepared = true;
      }
      activationReady.resolve(undefined);
      lastEventId = await observedConsumePromise;
    } catch (error) {
      activationReady.reject(error);
      await observedConsumePromise.catch(() => undefined);
      if (options.signal?.aborted) return;
      if (isTerminalTailError(error)) throw error;
      options.onError?.(error);
    }
    await waitForReconnect(options.reconnectDelayMs, options.signal);
  }
}
