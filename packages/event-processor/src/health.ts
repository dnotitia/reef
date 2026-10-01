import { createServer, type Server } from "node:http";
import type {
  EventProcessorReconciliationOutcome,
  EventProcessorTailState,
} from "./processor.js";

interface InstallationHealth {
  vaultId: string;
  active: boolean;
  ready: boolean;
  tailConnected: boolean;
  recovering: boolean;
  tailAttempts: number;
  tailReconnects: number;
  eventGapRecoveries: number;
  notificationsFannedOut: number;
  reconciliationSuccesses: number;
  reconciliationFailures: number;
  failures: number;
}

function metricLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n");
}

export class ProcessorHealth {
  private ready = false;
  private stopping = false;
  private tailConnected = false;
  private recovering = false;
  private tailAttempts = 0;
  private tailReconnects = 0;
  private eventGapRecoveries = 0;
  private reconciliationSuccesses = 0;
  private reconciliationFailures = 0;
  private activityScanned = 0;
  private commentScanned = 0;
  private notificationsFannedOut = 0;
  private lastTailConnectionSeconds = 0;
  private lastReconciliationSuccessSeconds = 0;
  private lastReconciliationFailureSeconds = 0;
  private inventoryManaged = false;
  private inventoryReady = false;
  private inventoryRefreshSuccesses = 0;
  private inventoryRefreshFailures = 0;
  private readonly installations = new Map<string, InstallationHealth>();
  private readonly startedAtMs = Date.now();

  registerInstallation(installationId: string, vaultId: string): void {
    const existing = this.installations.get(installationId);
    if (existing) {
      existing.active = true;
      existing.vaultId = vaultId;
      existing.ready = false;
      existing.tailConnected = false;
      existing.recovering = false;
      return;
    }
    this.installations.set(installationId, {
      vaultId,
      active: true,
      ready: false,
      tailConnected: false,
      recovering: false,
      tailAttempts: 0,
      tailReconnects: 0,
      eventGapRecoveries: 0,
      notificationsFannedOut: 0,
      reconciliationSuccesses: 0,
      reconciliationFailures: 0,
      failures: 0,
    });
  }

  markInstallationRemoved(installationId: string): void {
    const installation = this.installations.get(installationId);
    if (!installation) return;
    installation.active = false;
    installation.ready = false;
    installation.tailConnected = false;
    installation.recovering = false;
  }

  markInventoryRefresh(outcome: "success" | "failure"): void {
    this.inventoryManaged = true;
    if (outcome === "success") {
      this.inventoryRefreshSuccesses += 1;
      this.inventoryReady = !this.stopping;
      return;
    }
    this.inventoryRefreshFailures += 1;
  }

  markInstallationReady(installationId: string): void {
    const installation = this.installations.get(installationId);
    if (installation && !this.stopping) installation.ready = true;
  }

  markInstallationFailed(installationId: string): void {
    const installation = this.installations.get(installationId);
    if (!installation) return;
    installation.failures += 1;
    installation.ready = false;
    installation.tailConnected = false;
  }

  markInstallationTailState(
    installationId: string,
    state: EventProcessorTailState,
  ): void {
    const installation = this.installations.get(installationId);
    if (!installation) return;
    if (state === "connecting") {
      if (installation.tailAttempts > 0) installation.tailReconnects += 1;
      installation.tailAttempts += 1;
      installation.tailConnected = false;
      return;
    }
    installation.tailConnected = state === "connected";
  }

  markInstallationRecoveryChange(
    installationId: string,
    recovering: boolean,
  ): void {
    const installation = this.installations.get(installationId);
    if (!installation) return;
    if (recovering && !installation.recovering) {
      installation.eventGapRecoveries += 1;
    }
    installation.recovering = recovering;
    if (recovering) installation.ready = false;
    else if (!this.stopping) installation.ready = true;
  }

  recordInstallationReconciliation(
    installationId: string,
    outcome: EventProcessorReconciliationOutcome,
  ): void {
    const installation = this.installations.get(installationId);
    if (installation) {
      if (outcome.status === "success") {
        installation.reconciliationSuccesses += 1;
        installation.notificationsFannedOut +=
          outcome.result.activity.fannedOut + outcome.result.comment.fannedOut;
        if (!this.stopping) installation.ready = true;
      } else {
        installation.reconciliationFailures += 1;
        installation.ready = false;
      }
    }
    this.recordReconciliation(outcome, installationId);
  }

  markReady(): void {
    if (!this.stopping) this.ready = true;
  }

  markNotReady(): void {
    this.ready = false;
  }

  markStopping(): void {
    this.stopping = true;
    this.ready = false;
    this.inventoryReady = false;
    this.tailConnected = false;
    for (const installation of this.installations.values()) {
      installation.ready = false;
      installation.tailConnected = false;
      installation.recovering = false;
    }
  }

  markTailState(state: EventProcessorTailState): void {
    if (state === "connecting") {
      if (this.tailAttempts > 0) this.tailReconnects += 1;
      this.tailAttempts += 1;
      this.tailConnected = false;
      return;
    }
    if (state === "connected") {
      this.tailConnected = true;
      this.lastTailConnectionSeconds = Date.now() / 1_000;
      return;
    }
    this.tailConnected = false;
  }

  markRecoveryChange(recovering: boolean): void {
    if (recovering) {
      if (!this.recovering) this.eventGapRecoveries += 1;
      this.recovering = true;
      this.ready = false;
      return;
    }
    this.recovering = false;
  }

  recordReconciliation(
    outcome: EventProcessorReconciliationOutcome,
    installationId?: string,
  ): void {
    const now = Date.now() / 1_000;
    if (outcome.status === "success") {
      this.reconciliationSuccesses += 1;
      this.activityScanned += outcome.result.activity.scanned;
      this.commentScanned += outcome.result.comment.scanned;
      this.notificationsFannedOut +=
        outcome.result.activity.fannedOut + outcome.result.comment.fannedOut;
      this.lastReconciliationSuccessSeconds = now;
      if (
        !this.stopping &&
        !this.inventoryManaged &&
        installationId === undefined
      ) {
        this.ready = true;
      }
      return;
    }
    this.reconciliationFailures += 1;
    this.lastReconciliationFailureSeconds = now;
    if (!this.inventoryManaged && installationId === undefined)
      this.ready = false;
  }

  isReady(): boolean {
    if (this.inventoryManaged) return this.inventoryReady && !this.stopping;
    return this.ready && !this.stopping && !this.recovering;
  }

  metrics(): string {
    const lines = [
      "# HELP reef_event_processor_ready Whether the processor is ready for work and has not started graceful shutdown.",
      "# TYPE reef_event_processor_ready gauge",
      `reef_event_processor_ready ${this.isReady() ? 1 : 0}`,
      "# HELP reef_event_processor_stopping Whether graceful shutdown has started.",
      "# TYPE reef_event_processor_stopping gauge",
      `reef_event_processor_stopping ${this.stopping ? 1 : 0}`,
      "# HELP reef_event_processor_tail_connected Whether the authenticated AKB event stream is open.",
      "# TYPE reef_event_processor_tail_connected gauge",
      `reef_event_processor_tail_connected ${this.tailConnected ? 1 : 0}`,
      "# HELP reef_event_processor_recovering Whether Event Gap source reconciliation is active.",
      "# TYPE reef_event_processor_recovering gauge",
      `reef_event_processor_recovering ${this.recovering ? 1 : 0}`,
      "# HELP reef_event_processor_tail_reconnects_total Number of tail reconnect attempts after the initial connection attempt.",
      "# TYPE reef_event_processor_tail_reconnects_total counter",
      `reef_event_processor_tail_reconnects_total ${this.tailReconnects}`,
      "# HELP reef_event_processor_event_gap_recoveries_total Number of Event Gap recovery sequences started.",
      "# TYPE reef_event_processor_event_gap_recoveries_total counter",
      `reef_event_processor_event_gap_recoveries_total ${this.eventGapRecoveries}`,
      "# HELP reef_event_processor_reconciliation_total Completed source reconciliation attempts by outcome.",
      "# TYPE reef_event_processor_reconciliation_total counter",
      `reef_event_processor_reconciliation_total{result="success"} ${this.reconciliationSuccesses}`,
      `reef_event_processor_reconciliation_total{result="failure"} ${this.reconciliationFailures}`,
      "# HELP reef_event_processor_source_rows_scanned_total Source rows scanned by successful reconciliations.",
      "# TYPE reef_event_processor_source_rows_scanned_total counter",
      `reef_event_processor_source_rows_scanned_total{source="activity"} ${this.activityScanned}`,
      `reef_event_processor_source_rows_scanned_total{source="comment"} ${this.commentScanned}`,
      "# HELP reef_event_processor_notifications_fanned_out_total Notifications fanned out by successful reconciliations.",
      "# TYPE reef_event_processor_notifications_fanned_out_total counter",
      `reef_event_processor_notifications_fanned_out_total ${this.notificationsFannedOut}`,
      "# HELP reef_event_processor_last_tail_connection_timestamp_seconds Time of the last accepted AKB event stream connection.",
      "# TYPE reef_event_processor_last_tail_connection_timestamp_seconds gauge",
      `reef_event_processor_last_tail_connection_timestamp_seconds ${this.lastTailConnectionSeconds}`,
      "# HELP reef_event_processor_last_reconciliation_success_timestamp_seconds Time of the last successful source reconciliation.",
      "# TYPE reef_event_processor_last_reconciliation_success_timestamp_seconds gauge",
      `reef_event_processor_last_reconciliation_success_timestamp_seconds ${this.lastReconciliationSuccessSeconds}`,
      "# HELP reef_event_processor_last_reconciliation_failure_timestamp_seconds Time of the last failed source reconciliation.",
      "# TYPE reef_event_processor_last_reconciliation_failure_timestamp_seconds gauge",
      `reef_event_processor_last_reconciliation_failure_timestamp_seconds ${this.lastReconciliationFailureSeconds}`,
      "# HELP reef_event_processor_inventory_ready Whether a complete app installation inventory has been read successfully.",
      "# TYPE reef_event_processor_inventory_ready gauge",
      `reef_event_processor_inventory_ready ${this.inventoryReady && !this.stopping ? 1 : 0}`,
      "# HELP reef_event_processor_inventory_refresh_total App installation inventory refresh attempts by outcome.",
      "# TYPE reef_event_processor_inventory_refresh_total counter",
      `reef_event_processor_inventory_refresh_total{result="success"} ${this.inventoryRefreshSuccesses}`,
      `reef_event_processor_inventory_refresh_total{result="failure"} ${this.inventoryRefreshFailures}`,
      "# HELP reef_event_processor_active_installations Number of active installation workers in the last valid inventory.",
      "# TYPE reef_event_processor_active_installations gauge",
      `reef_event_processor_active_installations ${[...this.installations.values()].filter((installation) => installation.active).length}`,
      "# HELP reef_event_processor_installation_active Whether this installation is present in the latest valid inventory.",
      "# TYPE reef_event_processor_installation_active gauge",
      "# HELP reef_event_processor_installation_ready Whether this installation is ready to process event sources.",
      "# TYPE reef_event_processor_installation_ready gauge",
      "# HELP reef_event_processor_installation_tail_connected Whether this installation's authenticated event stream is open.",
      "# TYPE reef_event_processor_installation_tail_connected gauge",
      "# HELP reef_event_processor_installation_tail_reconnects_total Number of tail reconnect attempts for this installation after the initial attempt.",
      "# TYPE reef_event_processor_installation_tail_reconnects_total counter",
      "# HELP reef_event_processor_installation_event_gap_recoveries_total Event gap recovery attempts by installation.",
      "# TYPE reef_event_processor_installation_event_gap_recoveries_total counter",
      "# HELP reef_event_processor_installation_recovering Whether this installation is recovering an event gap.",
      "# TYPE reef_event_processor_installation_recovering gauge",
      "# HELP reef_event_processor_installation_reconciliation_total Source reconciliation attempts by installation and outcome.",
      "# TYPE reef_event_processor_installation_reconciliation_total counter",
      "# HELP reef_event_processor_installation_notifications_fanned_out_total Notifications created by source reconciliation for this installation.",
      "# TYPE reef_event_processor_installation_notifications_fanned_out_total counter",
      "# HELP reef_event_processor_installation_failures_total Terminal worker failures by installation.",
      "# TYPE reef_event_processor_installation_failures_total counter",
      ...[...this.installations.entries()].flatMap(
        ([installationId, installation]) => {
          const labels = `installation_id="${metricLabel(installationId)}",vault_id="${metricLabel(installation.vaultId)}"`;
          return [
            `reef_event_processor_installation_active{${labels}} ${installation.active ? 1 : 0}`,
            `reef_event_processor_installation_ready{${labels}} ${installation.ready && !this.stopping ? 1 : 0}`,
            `reef_event_processor_installation_tail_connected{${labels}} ${installation.tailConnected ? 1 : 0}`,
            `reef_event_processor_installation_tail_reconnects_total{${labels}} ${installation.tailReconnects}`,
            `reef_event_processor_installation_event_gap_recoveries_total{${labels}} ${installation.eventGapRecoveries}`,
            `reef_event_processor_installation_recovering{${labels}} ${installation.recovering ? 1 : 0}`,
            `reef_event_processor_installation_reconciliation_total{${labels},result="success"} ${installation.reconciliationSuccesses}`,
            `reef_event_processor_installation_reconciliation_total{${labels},result="failure"} ${installation.reconciliationFailures}`,
            `reef_event_processor_installation_notifications_fanned_out_total{${labels}} ${installation.notificationsFannedOut}`,
            `reef_event_processor_installation_failures_total{${labels}} ${installation.failures}`,
          ];
        },
      ),
      "# HELP reef_event_processor_uptime_seconds Process uptime in seconds.",
      "# TYPE reef_event_processor_uptime_seconds gauge",
      `reef_event_processor_uptime_seconds ${Math.max(0, (Date.now() - this.startedAtMs) / 1_000)}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}

function send(
  response: import("node:http").ServerResponse,
  status: number,
  body: string,
  contentType: string,
): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

export function createHealthServer(health: ProcessorHealth): Server {
  return createServer((request, response) => {
    if (request.method !== "GET") {
      send(response, 405, "Method Not Allowed\n", "text/plain; charset=utf-8");
      return;
    }
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/healthz") {
      send(
        response,
        200,
        '{"status":"alive"}\n',
        "application/json; charset=utf-8",
      );
      return;
    }
    if (path === "/readyz") {
      const ready = health.isReady();
      send(
        response,
        ready ? 200 : 503,
        ready ? '{"status":"ready"}\n' : '{"status":"not_ready"}\n',
        "application/json; charset=utf-8",
      );
      return;
    }
    if (path === "/metrics") {
      send(
        response,
        200,
        health.metrics(),
        "text/plain; version=0.0.4; charset=utf-8",
      );
      return;
    }
    send(response, 404, "Not Found\n", "text/plain; charset=utf-8");
  });
}

export function listenHealthServer(
  server: Server,
  host: string,
  port: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

export function closeHealthServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
