import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AkbNotificationProjectionResult,
  AkbNotificationProjectorInput,
  AkbStreamAdapter,
} from "@reef/core";

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  listInstallations: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@reef/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@reef/core")>();
  const adapter = {
    request: mocks.request,
    stream: vi.fn(
      async (_path: string, init?: { signal?: AbortSignal }) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.close(),
                { once: true },
              );
            },
          }),
        ),
    ),
  } satisfies AkbStreamAdapter;
  return {
    ...core,
    createAkbAdapter: () => adapter,
    akbProjectNotifications: mocks.project,
    createAkbAppInstallationInventoryReader: () => ({
      listActiveInstallations: mocks.listInstallations,
    }),
  };
});
import { createEventProcessorFleet } from "./index.js";

const result: AkbNotificationProjectionResult = {
  activatedAt: "2026-11-04T00:00:00.000Z",
  activated: false,
  activity: {
    scanned: 0,
    fannedOut: 0,
    skippedMalformed: 0,
    skippedNoRecipients: 0,
    cursor: null,
    failed: false,
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

afterEach(() => vi.clearAllMocks());

describe("event processor composition", () => {
  it("cancels the active AKB request when the fleet shuts down", async () => {
    const controller = new AbortController();
    mocks.listInstallations.mockResolvedValue([
      {
        installationId: "00000000-0000-4000-8000-000000000001",
        appId: "11111111-1111-4111-8111-111111111111",
        vaultId: "10000000-0000-4000-8000-000000000001",
        vaultName: "reef-alpha",
        lifecycle: "active",
      },
    ]);
    let upstreamSignal: AbortSignal | undefined;
    mocks.request.mockImplementation(
      (_path: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          upstreamSignal = init?.signal;
          upstreamSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("closed", "AbortError")),
            { once: true },
          );
        }),
    );
    mocks.project.mockImplementation(
      async ({ adapter }: AkbNotificationProjectorInput) => {
        await adapter.request("/api/v1/tables/reef-alpha/sql");
        return result;
      },
    );
    const onReconciliation = vi.fn();
    const processor = createEventProcessorFleet({
      baseUrl: "https://akb.test",
      credential: "test-token",
      appCredential: "test-app-credential",
      onInventoryRefresh: vi.fn(),
      onInstallationAdded: vi.fn(),
      onInstallationRemoved: vi.fn(),
      onInstallationReady: vi.fn(),
      onInstallationReconciliation: onReconciliation,
      onInstallationFailure: vi.fn(),
      onInstallationError: vi.fn(),
    });
    const running = processor.run(controller.signal);
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    controller.abort();
    await running;
    expect(upstreamSignal?.aborted).toBe(true);
    expect(onReconciliation).not.toHaveBeenCalled();
  });

  it("limits all 31 installations to two active AKB projections and drains queued work on shutdown", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    mocks.listInstallations.mockResolvedValue(
      Array.from({ length: 31 }, (_, index) => ({
        installationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        appId: "11111111-1111-4111-8111-111111111111",
        vaultId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        vaultName: `reef-${index}`,
        lifecycle: "active",
      })),
    );
    mocks.project.mockImplementation(async () => {
      active += 1;
      try {
        await gate;
        return result;
      } finally {
        active -= 1;
      }
    });
    const processor = createEventProcessorFleet({
      baseUrl: "https://akb.test",
      credential: "test-token",
      appCredential: "test-app-credential",
      reconciliationIntervalMs: 60_000,
      onInventoryRefresh: vi.fn(),
      onInstallationAdded: vi.fn(),
      onInstallationRemoved: vi.fn(),
      onInstallationReady: vi.fn(),
      onInstallationReconciliation: vi.fn(),
      onInstallationFailure: vi.fn(),
      onInstallationError: vi.fn(),
    });
    const running = processor.run(controller.signal);
    try {
      await vi.waitFor(() => expect(mocks.project).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(active).toBe(2);
      expect(mocks.project).toHaveBeenCalledTimes(2);
    } finally {
      controller.abort();
      release();
      await running;
    }
    expect(active).toBe(0);
    expect(mocks.project).toHaveBeenCalledTimes(2);
  });
});
