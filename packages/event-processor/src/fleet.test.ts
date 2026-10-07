import { describe, expect, it, vi } from "vitest";
import type { ControlPlaneInstallationInventoryItem } from "@reef/core";
import { runEventProcessorFleet } from "./fleet.js";

const APP_ID = "11111111-1111-4111-8111-111111111111";

function installation(
  installationId: string,
  vaultId: string,
  vaultName: string,
): ControlPlaneInstallationInventoryItem {
  return {
    installationId,
    appId: APP_ID,
    vaultId,
    vaultName,
    lifecycle: "active",
  };
}

const A = installation(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "11111111-1111-4111-8111-111111111111",
  "alpha",
);
const B = installation(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "22222222-2222-4222-8222-222222222222",
  "beta",
);
const C = installation(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "33333333-3333-4333-8333-333333333333",
  "gamma",
);

function callbacks() {
  return {
    onInventoryRefresh: vi.fn(),
    onInstallationAdded: vi.fn(),
    onInstallationRemoved: vi.fn(),
    onInstallationReady: vi.fn(),
    onInstallationTailState: vi.fn(),
    onInstallationRecoveryChange: vi.fn(),
    onInstallationReconciliation: vi.fn(),
    onInstallationFailure: vi.fn(),
    onInstallationError: vi.fn(),
  };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

describe("runEventProcessorFleet", () => {
  it("adds and removes installations while preserving unaffected workers", async () => {
    const controller = new AbortController();
    const options = callbacks();
    const snapshots = [
      [A, B],
      [B, C],
    ];
    const workerSignals = new Map<string, AbortSignal>();
    const stoppedInstallations = new Set<string>();
    const createRunner = vi.fn(
      (target: ControlPlaneInstallationInventoryItem) => ({
        run: async (signal?: AbortSignal) => {
          workerSignals.set(target.installationId, signal as AbortSignal);
          await waitForAbort(signal as AbortSignal);
          stoppedInstallations.add(target.installationId);
        },
      }),
    );
    options.onInstallationRemoved.mockImplementation((target) => {
      expect(stoppedInstallations.has(target.installationId)).toBe(true);
    });
    const running = runEventProcessorFleet({
      ...options,
      listActiveInstallations: async () => {
        const next = snapshots.shift();
        if (!next) throw new Error("unexpected inventory read");
        return next;
      },
      createRunner,
      refreshIntervalMs: 200,
      signal: controller.signal,
    });

    await vi.waitFor(() =>
      expect(options.onInstallationAdded).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() =>
      expect(options.onInstallationRemoved).toHaveBeenCalledWith(A),
    );
    await vi.waitFor(() =>
      expect(options.onInstallationAdded).toHaveBeenCalledTimes(3),
    );
    expect(workerSignals.get(A.installationId)?.aborted).toBe(true);
    expect(workerSignals.get(B.installationId)?.aborted).toBe(false);
    expect(workerSignals.get(C.installationId)?.aborted).toBe(false);
    expect(options.onInventoryRefresh).toHaveBeenNthCalledWith(1, "success", 2);
    expect(options.onInventoryRefresh).toHaveBeenNthCalledWith(2, "success", 2);

    controller.abort();
    await running;
  });

  it("keeps current workers when an inventory refresh fails", async () => {
    const controller = new AbortController();
    const options = callbacks();
    const readInventory = vi
      .fn<() => Promise<ControlPlaneInstallationInventoryItem[]>>()
      .mockResolvedValueOnce([A])
      .mockRejectedValue(new Error("inventory unavailable"));
    let workerSignal: AbortSignal | undefined;
    const running = runEventProcessorFleet({
      ...options,
      listActiveInstallations: readInventory,
      createRunner: () => ({
        run: (signal) => {
          workerSignal = signal;
          return waitForAbort(signal as AbortSignal);
        },
      }),
      refreshIntervalMs: 200,
      signal: controller.signal,
    });

    await vi.waitFor(() =>
      expect(options.onInventoryRefresh).toHaveBeenCalledTimes(2),
    );
    expect(options.onInventoryRefresh).toHaveBeenNthCalledWith(1, "success", 1);
    expect(options.onInventoryRefresh).toHaveBeenNthCalledWith(
      2,
      "failure",
      undefined,
      expect.any(Error),
    );
    expect(workerSignal?.aborted).toBe(false);
    expect(options.onInstallationRemoved).not.toHaveBeenCalled();

    controller.abort();
    await running;
  });

  it("retries a failed installation on the next good snapshot without restarting peers", async () => {
    const controller = new AbortController();
    const options = callbacks();
    const createRunner = vi.fn(
      (target: ControlPlaneInstallationInventoryItem) => ({
        run: async (signal?: AbortSignal) => {
          const count = createRunner.mock.calls.filter(
            ([candidate]) => candidate.installationId === target.installationId,
          ).length;
          if (target.installationId === A.installationId && count === 1) {
            throw new Error("target failed");
          }
          await waitForAbort(signal as AbortSignal);
        },
      }),
    );
    const running = runEventProcessorFleet({
      ...options,
      listActiveInstallations: async () => [A, B],
      createRunner,
      refreshIntervalMs: 20,
      signal: controller.signal,
    });

    await vi.waitFor(() => {
      expect(
        createRunner.mock.calls.filter(
          ([target]) => target.installationId === A.installationId,
        ),
      ).toHaveLength(2);
    });
    expect(
      createRunner.mock.calls.filter(
        ([target]) => target.installationId === B.installationId,
      ),
    ).toHaveLength(1);
    expect(options.onInstallationFailure).toHaveBeenCalledWith(
      A,
      expect.objectContaining({ message: "target failed" }),
    );

    controller.abort();
    await running;
  });
});
