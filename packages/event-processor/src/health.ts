import { createServer, type Server } from "node:http";
import type {
  EventProcessorReconciliationOutcome,
  EventProcessorTailState,
} from "./processor.js";

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
  private readonly startedAtMs = Date.now();

  markReady(): void {
    if (!this.stopping) this.ready = true;
  }

  markNotReady(): void {
    this.ready = false;
  }

  markStopping(): void {
    this.stopping = true;
    this.ready = false;
    this.tailConnected = false;
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

  recordReconciliation(outcome: EventProcessorReconciliationOutcome): void {
    const now = Date.now() / 1_000;
    if (outcome.status === "success") {
      this.reconciliationSuccesses += 1;
      this.activityScanned += outcome.result.activity.scanned;
      this.commentScanned += outcome.result.comment.scanned;
      this.notificationsFannedOut +=
        outcome.result.activity.fannedOut + outcome.result.comment.fannedOut;
      this.lastReconciliationSuccessSeconds = now;
      if (!this.stopping) this.ready = true;
      return;
    }
    this.reconciliationFailures += 1;
    this.lastReconciliationFailureSeconds = now;
    this.ready = false;
  }

  isReady(): boolean {
    return this.ready && !this.stopping && !this.recovering;
  }

  metrics(): string {
    const lines = [
      "# HELP reef_event_processor_ready Whether startup reconciliation has succeeded and shutdown has not started.",
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
