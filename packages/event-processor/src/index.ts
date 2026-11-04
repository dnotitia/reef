import pLimit from "p-limit";
import {
  akbProjectNotifications,
  createAkbAdapter,
  createAkbAppInstallationInventoryReader,
  type AkbAdapter,
  type AkbRequestPolicy,
} from "@reef/core";
import {
  runEventProcessorFleet,
  type EventProcessorFleetOptions,
} from "./fleet.js";
import {
  DEFAULT_RECONCILIATION_INTERVAL_MS,
  runEventProcessor,
} from "./processor.js";

export interface EventProcessorFleetCompositionOptions
  extends Omit<
    EventProcessorFleetOptions,
    "listActiveInstallations" | "createRunner" | "refreshIntervalMs" | "signal"
  > {
  baseUrl: string;
  credential: string;
  appCredential: string;
  batchSize?: number;
  reconciliationIntervalMs?: number;
  requestPolicy?: AkbRequestPolicy;
}

export interface EventProcessor {
  run(signal?: AbortSignal): Promise<void>;
}

/** Bound source reconciliation across the entire deployment, independent of Vault count. */
export function createEventProcessorFleet(
  options: EventProcessorFleetCompositionOptions,
): EventProcessor {
  const {
    baseUrl,
    credential,
    appCredential,
    batchSize,
    reconciliationIntervalMs = DEFAULT_RECONCILIATION_INTERVAL_MS,
    requestPolicy,
    ...callbacks
  } = options;
  const inventory = createAkbAppInstallationInventoryReader({
    baseUrl,
    appCredential,
    requestPolicy,
  });
  const adapter = createAkbAdapter({ baseUrl, credential, requestPolicy });
  return {
    async run(signal) {
      const limit = pLimit(2);
      await runEventProcessorFleet({
        ...callbacks,
        listActiveInstallations: () => inventory.listActiveInstallations(),
        refreshIntervalMs: reconciliationIntervalMs,
        signal,
        createRunner: (installation, handlers) => ({
          run: (workerSignal) => {
            const workerAdapter: AkbAdapter = {
              request: (path, init) =>
                adapter.request(path, {
                  ...init,
                  signal: init?.signal
                    ? AbortSignal.any([workerSignal, init.signal])
                    : workerSignal,
                }),
            };
            return runEventProcessor(
              {
                projectNotifications: () =>
                  limit(() => {
                    workerSignal.throwIfAborted();
                    return akbProjectNotifications({
                      adapter: workerAdapter,
                      vault: installation.vaultName,
                      batchSize,
                    });
                  }),
              },
              {
                signal: workerSignal,
                reconciliationIntervalMs,
                onReady: handlers.onReady,
                onReconciliation: handlers.onReconciliation,
                onError: handlers.onError,
              },
            );
          },
        }),
      });
    },
  };
}
