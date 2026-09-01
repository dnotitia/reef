import {
  akbProjectNotifications,
  createAkbAdapter,
  createAkbChangeEventTail,
  type AkbRequestPolicy,
} from "@reef/core";
import {
  runEventProcessor,
  type EventProcessorRuntime,
  type RunEventProcessorOptions,
} from "./processor.js";

export interface EventProcessorOptions {
  baseUrl: string;
  jwt: string;
  vault: string;
  batchSize?: number;
  reconnectDelayMs?: number;
  onError?: (error: unknown) => void;
  requestPolicy?: AkbRequestPolicy;
}

export interface EventProcessor {
  run(signal?: AbortSignal): Promise<void>;
}

/**
 * Compose the private processor from deployment-managed AKB credentials and
 * Core's public adapter/projector contracts. No browser or orchestrator code
 * is reachable from this package.
 */
export function createEventProcessor(
  options: EventProcessorOptions,
): EventProcessor {
  const adapter = createAkbAdapter({
    baseUrl: options.baseUrl,
    jwt: options.jwt,
    ...(options.requestPolicy ? { requestPolicy: options.requestPolicy } : {}),
  });
  const tail = createAkbChangeEventTail(adapter);
  const runtime: EventProcessorRuntime = {
    tail,
    projectNotifications: () =>
      akbProjectNotifications({
        adapter,
        vault: options.vault,
        ...(options.batchSize === undefined
          ? {}
          : { batchSize: options.batchSize }),
      }),
  };
  const runOptions = (signal?: AbortSignal): RunEventProcessorOptions => ({
    vault: options.vault,
    signal,
    reconnectDelayMs: options.reconnectDelayMs ?? 1_000,
    onError: options.onError,
  });
  return {
    run: (signal) => runEventProcessor(runtime, runOptions(signal)),
  };
}
