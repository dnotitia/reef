import { setTimeout as sleep } from "node:timers/promises";
import type { ControlPlaneInstallationInventoryItem } from "@reef/core";
import type {
  EventProcessorReconciliationOutcome,
  EventProcessorTailState,
} from "./processor.js";

export interface EventProcessorFleetRunner {
  run(signal?: AbortSignal): Promise<void>;
}

export interface EventProcessorFleetWorkerHandlers {
  onReady: () => void;
  onTailState: (state: EventProcessorTailState) => void;
  onRecoveryChange: (recovering: boolean) => void;
  onReconciliation: (outcome: EventProcessorReconciliationOutcome) => void;
  onError: (error: unknown) => void;
}

export interface EventProcessorFleetOptions {
  listActiveInstallations: () => Promise<
    ControlPlaneInstallationInventoryItem[]
  >;
  createRunner: (
    installation: ControlPlaneInstallationInventoryItem,
    handlers: EventProcessorFleetWorkerHandlers,
  ) => EventProcessorFleetRunner;
  refreshIntervalMs: number;
  signal?: AbortSignal;
  onInventoryRefresh: (
    outcome: "success" | "failure",
    count?: number,
    error?: unknown,
  ) => void;
  onInstallationAdded: (
    installation: ControlPlaneInstallationInventoryItem,
  ) => void;
  onInstallationRemoved: (
    installation: ControlPlaneInstallationInventoryItem,
  ) => void;
  onInstallationReady: (
    installation: ControlPlaneInstallationInventoryItem,
  ) => void;
  onInstallationTailState: (
    installation: ControlPlaneInstallationInventoryItem,
    state: EventProcessorTailState,
  ) => void;
  onInstallationRecoveryChange: (
    installation: ControlPlaneInstallationInventoryItem,
    recovering: boolean,
  ) => void;
  onInstallationReconciliation: (
    installation: ControlPlaneInstallationInventoryItem,
    outcome: EventProcessorReconciliationOutcome,
  ) => void;
  onInstallationFailure: (
    installation: ControlPlaneInstallationInventoryItem,
    error: unknown,
  ) => void;
  onInstallationError: (
    installation: ControlPlaneInstallationInventoryItem,
    error: unknown,
  ) => void;
}

interface RunningInstallation {
  installation: ControlPlaneInstallationInventoryItem;
  controller: AbortController;
  running: Promise<void> | null;
}

function sameInstallation(
  left: ControlPlaneInstallationInventoryItem,
  right: ControlPlaneInstallationInventoryItem,
): boolean {
  return (
    left.installationId === right.installationId &&
    left.appId === right.appId &&
    left.vaultId === right.vaultId &&
    left.vaultName === right.vaultName &&
    left.lifecycle === right.lifecycle
  );
}

async function waitForRefresh(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  try {
    await sleep(delayMs, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

/** Keep one independent processor and event cursor per active installation. */
export async function runEventProcessorFleet(
  options: EventProcessorFleetOptions,
): Promise<void> {
  if (
    !Number.isSafeInteger(options.refreshIntervalMs) ||
    options.refreshIntervalMs <= 0
  ) {
    throw new TypeError("refreshIntervalMs must be a positive integer");
  }

  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const installations = new Map<string, RunningInstallation>();

  const stopInstallation = async (
    running: RunningInstallation,
    removed: boolean,
  ): Promise<void> => {
    running.controller.abort();
    await running.running?.catch(() => undefined);
    if (removed) options.onInstallationRemoved(running.installation);
  };

  const startInstallation = (
    installation: ControlPlaneInstallationInventoryItem,
    current: RunningInstallation,
  ): void => {
    const handlers: EventProcessorFleetWorkerHandlers = {
      onReady: () => options.onInstallationReady(installation),
      onTailState: (state) =>
        options.onInstallationTailState(installation, state),
      onRecoveryChange: (recovering) =>
        options.onInstallationRecoveryChange(installation, recovering),
      onReconciliation: (outcome) =>
        options.onInstallationReconciliation(installation, outcome),
      onError: (error) => options.onInstallationError(installation, error),
    };

    current.running = Promise.resolve()
      .then(() =>
        options
          .createRunner(installation, handlers)
          .run(current.controller.signal),
      )
      .then(
        () => {
          if (!current.controller.signal.aborted) {
            options.onInstallationFailure(
              installation,
              new Error("processor stopped unexpectedly"),
            );
          }
        },
        (error: unknown) => {
          if (!current.controller.signal.aborted) {
            options.onInstallationFailure(installation, error);
          }
        },
      )
      .finally(() => {
        if (installations.get(installation.installationId) === current) {
          current.running = null;
        }
      });
  };

  const refresh = async (): Promise<void> => {
    let snapshot: ControlPlaneInstallationInventoryItem[];
    try {
      snapshot = await options.listActiveInstallations();
    } catch (error) {
      options.onInventoryRefresh("failure", undefined, error);
      return;
    }

    options.onInventoryRefresh("success", snapshot.length);
    const desired = new Map(
      snapshot.map((item) => [item.installationId, item]),
    );
    const retiring: Promise<void>[] = [];

    for (const [installationId, current] of installations) {
      const next = desired.get(installationId);
      if (next && sameInstallation(current.installation, next)) continue;
      installations.delete(installationId);
      retiring.push(stopInstallation(current, true));
    }
    await Promise.all(retiring);

    for (const installation of snapshot) {
      const current = installations.get(installation.installationId);
      if (current) {
        if (current.running === null) startInstallation(installation, current);
        continue;
      }
      const created: RunningInstallation = {
        installation,
        controller: new AbortController(),
        running: null,
      };
      installations.set(installation.installationId, created);
      options.onInstallationAdded(installation);
      startInstallation(installation, created);
    }
  };

  try {
    while (!signal.aborted) {
      await refresh();
      if (!signal.aborted) {
        await waitForRefresh(options.refreshIntervalMs, signal);
      }
    }
  } finally {
    controller.abort();
    const running = [...installations.values()];
    installations.clear();
    await Promise.all(
      running.map((installation) => stopInstallation(installation, false)),
    );
  }
}
