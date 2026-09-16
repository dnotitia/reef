import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeHealthServer,
  createHealthServer,
  listenHealthServer,
  ProcessorHealth,
} from "./health.js";

describe("event processor health endpoints", () => {
  let server: ReturnType<typeof createHealthServer> | undefined;

  afterEach(async () => {
    if (server) await closeHealthServer(server);
    server = undefined;
  });

  it("separates liveness from startup and shutdown readiness", async () => {
    const health = new ProcessorHealth();
    server = createHealthServer(health);
    await listenHealthServer(server, "127.0.0.1", 0);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(503);

    health.recordReconciliation({
      status: "success",
      result: {
        activatedAt: "2026-09-01T10:00:00.000Z",
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
      },
    });
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);

    health.markStopping();
    expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/readyz`)).status).toBe(503);
  });

  it("exposes tail, recovery, projection counts, and last success without credentials", async () => {
    const health = new ProcessorHealth();
    health.markTailState("connecting");
    health.markTailState("connected");
    health.markRecoveryChange(true);
    health.recordReconciliation({
      status: "success",
      result: {
        activatedAt: "2026-09-01T10:00:00.000Z",
        activated: false,
        activity: {
          scanned: 1,
          fannedOut: 1,
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
      },
    });
    server = createHealthServer(health);
    await listenHealthServer(server, "127.0.0.1", 0);
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("reef_event_processor_tail_connected 1");
    expect(body).toContain("reef_event_processor_recovering 1");
    expect(body).toContain(
      'reef_event_processor_reconciliation_total{result="success"} 1',
    );
    expect(body).toContain(
      "reef_event_processor_last_reconciliation_success_timestamp_seconds ",
    );
    expect(body).not.toContain("processor-test-credential");
  });

  it("drops readiness after a failed projection and records the failure timestamp", async () => {
    const health = new ProcessorHealth();
    health.markReady();
    health.recordReconciliation({
      status: "failure",
      error: new Error("projection failed"),
    });

    expect(health.isReady()).toBe(false);
    const metrics = health.metrics();
    expect(metrics).toContain(
      'reef_event_processor_reconciliation_total{result="failure"} 1',
    );
    expect(metrics).toContain(
      "reef_event_processor_last_reconciliation_failure_timestamp_seconds ",
    );
    expect(metrics).not.toContain("projection failed");
  });
});
