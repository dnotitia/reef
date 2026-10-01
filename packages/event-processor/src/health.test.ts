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
    expect(body).toContain(
      "# HELP reef_event_processor_ready Whether the processor is ready for work and has not started graceful shutdown.",
    );
    expect(body).toContain(
      "# HELP reef_event_processor_installation_ready Whether this installation is ready to process event sources.",
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

  it("keeps process readiness tied to inventory while reporting each installation separately", () => {
    const health = new ProcessorHealth();
    health.markInventoryRefresh("failure");
    expect(health.isReady()).toBe(false);

    health.registerInstallation(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "11111111-1111-4111-8111-111111111111",
    );
    health.registerInstallation(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "22222222-2222-4222-8222-222222222222",
    );
    health.markInventoryRefresh("success");
    health.markInstallationReady("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    health.markInstallationReady("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    health.markInstallationTailState(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "connected",
    );
    health.recordInstallationReconciliation(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      {
        status: "success",
        result: {
          activatedAt: "2026-09-01T10:00:00.000Z",
          activated: false,
          activity: {
            scanned: 3,
            fannedOut: 2,
            skippedMalformed: 0,
            skippedNoRecipients: 0,
            cursor: null,
            failed: false,
          },
          comment: {
            scanned: 1,
            fannedOut: 1,
            skippedMalformed: 0,
            skippedNoRecipients: 0,
            cursor: null,
            failed: false,
          },
        },
      },
    );
    health.recordInstallationReconciliation(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      { status: "failure", error: new Error("one vault denied access") },
    );
    health.markInstallationFailed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    health.markInventoryRefresh("failure");

    expect(health.isReady()).toBe(true);
    const metrics = health.metrics();
    expect(metrics).toContain("reef_event_processor_inventory_ready 1");
    expect(metrics).toContain("reef_event_processor_active_installations 2");
    expect(metrics).toContain(
      'reef_event_processor_installation_ready{installation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",vault_id="11111111-1111-4111-8111-111111111111"} 0',
    );
    expect(metrics).toContain(
      'reef_event_processor_installation_tail_connected{installation_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",vault_id="22222222-2222-4222-8222-222222222222"} 1',
    );
    expect(metrics).toContain(
      'reef_event_processor_installation_reconciliation_total{installation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",vault_id="11111111-1111-4111-8111-111111111111",result="failure"} 1',
    );
    expect(metrics).toContain(
      'reef_event_processor_installation_notifications_fanned_out_total{installation_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",vault_id="22222222-2222-4222-8222-222222222222"} 3',
    );
    expect(metrics).toContain(
      'reef_event_processor_installation_failures_total{installation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",vault_id="11111111-1111-4111-8111-111111111111"} 1',
    );
    expect(metrics).not.toContain("one vault denied access");

    health.markInstallationRemoved("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const removedMetrics = health.metrics();
    expect(removedMetrics).toContain(
      "reef_event_processor_active_installations 1",
    );
    expect(removedMetrics).toContain(
      'reef_event_processor_installation_active{installation_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",vault_id="11111111-1111-4111-8111-111111111111"} 0',
    );
  });
});
