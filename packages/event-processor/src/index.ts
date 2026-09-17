import {
  akbProjectNotifications,
  createAkbAdapter,
  createAkbChangeEventTail,
  type AkbRequestPolicy,
} from "@reef/core";
import {
  runEventProcessor,
  type EventProcessorReconciliationOutcome,
  type EventProcessorTailState,
  type EventProcessorRuntime,
  type RunEventProcessorOptions,
} from "./processor.js";

export interface EventProcessorOptions {
  baseUrl: string;
  credential: string;
  vault: string;
  batchSize?: number;
  reconnectDelayMs?: number;
  reconciliationIntervalMs?: number;
  onError?: (error: unknown) => void;
  onReady?: () => void;
  onTailState?: (state: EventProcessorTailState) => void;
  onRecoveryChange?: (recovering: boolean) => void;
  onReconciliation?: (outcome: EventProcessorReconciliationOutcome) => void;
  requestPolicy?: AkbRequestPolicy;
}

export interface EventProcessor {
  run(signal?: AbortSignal): Promise<void>;
}

/**
 * Compose the private processor from deployment-managed AKB credentials and
 * Core's public adapter/projector contracts. No browser or web code
 * is reachable from this package.
 */
export function createEventProcessor(
  options: EventProcessorOptions,
): EventProcessor {
  const adapter = createAkbAdapter({
    baseUrl: options.baseUrl,
    credential: options.credential,
    requestPolicy: options.requestPolicy,
  });
  const tail = createAkbChangeEventTail(adapter);
  const runtime: EventProcessorRuntime = {
    tail,
    projectNotifications: () =>
      akbProjectNotifications({
        adapter,
        vault: options.vault,
        batchSize: options.batchSize,
      }),
  };
  const runOptions = (signal?: AbortSignal): RunEventProcessorOptions => ({
    vault: options.vault,
    signal,
    reconnectDelayMs: options.reconnectDelayMs ?? 1_000,
    reconciliationIntervalMs: options.reconciliationIntervalMs,
    onError: options.onError,
    onReady: options.onReady,
    onTailState: options.onTailState,
    onRecoveryChange: options.onRecoveryChange,
    onReconciliation: options.onReconciliation,
  });
  return {
    run: (signal) => runEventProcessor(runtime, runOptions(signal)),
  };
}
