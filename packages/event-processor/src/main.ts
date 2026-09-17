import { AuthError, EventTailError } from "@reef/core";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEventProcessor } from "./index.js";
import {
  parseEventProcessorConfig,
  type EventProcessorConfig,
} from "./config.js";
import {
  closeHealthServer,
  createHealthServer,
  listenHealthServer,
  ProcessorHealth,
} from "./health.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_JSON_RESPONSE_BYTES = 5 * 1_024 * 1_024;

function writeLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number | boolean> = {},
): void {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...fields,
    })}\n`,
  );
}

function errorFields(error: unknown): Record<string, string | number> {
  if (error instanceof EventTailError) {
    return {
      error_name: error.name,
      error_code: error.code,
      upstream_status: error.status,
    };
  }
  if (error instanceof AuthError) {
    return { error_name: error.name };
  }
  return {
    error_name: error instanceof Error ? error.name : "UnknownError",
  };
}

export async function waitForDrain(
  running: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      running.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type RunOutcome = { status: "stopped" } | { status: "failed"; error: unknown };

export async function main(): Promise<number> {
  let config: EventProcessorConfig;
  try {
    config = parseEventProcessorConfig(process.env);
  } catch (error) {
    const variable =
      typeof error === "object" &&
      error !== null &&
      "variable" in error &&
      typeof error.variable === "string"
        ? error.variable
        : "unknown";
    writeLog("error", "configuration_invalid", { variable });
    return 1;
  }

  const health = new ProcessorHealth();
  const healthServer = createHealthServer(health);
  try {
    await listenHealthServer(healthServer, config.host, config.port);
  } catch (error) {
    writeLog("error", "health_server_start_failed", errorFields(error));
    return 1;
  }

  const controller = new AbortController();
  let recoveryLogged = false;
  const processor = createEventProcessor({
    baseUrl: config.baseUrl,
    credential: config.credential,
    vault: config.vault,
    reconnectDelayMs: config.reconnectDelayMs,
    reconciliationIntervalMs: config.reconciliationIntervalMs,
    requestPolicy: {
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxJsonResponseBytes: MAX_JSON_RESPONSE_BYTES,
    },
    onReady: () => {
      health.markReady();
      writeLog("info", "processor_ready");
    },
    onTailState: (state) => {
      health.markTailState(state);
      if (state === "connected") writeLog("info", "event_tail_connected");
      if (state === "disconnected") writeLog("warn", "event_tail_disconnected");
    },
    onRecoveryChange: (recovering) => {
      health.markRecoveryChange(recovering);
      if (recovering && !recoveryLogged) {
        recoveryLogged = true;
        writeLog("warn", "event_gap_recovery_started");
      } else if (!recovering && recoveryLogged) {
        recoveryLogged = false;
        writeLog("info", "event_gap_recovery_completed");
      }
    },
    onReconciliation: (outcome) => health.recordReconciliation(outcome),
    onError: (error) => writeLog("warn", "processor_retry", errorFields(error)),
  });

  const running: Promise<RunOutcome> = processor.run(controller.signal).then(
    () => ({ status: "stopped" }),
    (error: unknown) => ({ status: "failed", error }),
  );
  let resolveShutdown: (signal: "SIGTERM" | "SIGINT") => void = () => undefined;
  const shutdownRequested = new Promise<"SIGTERM" | "SIGINT">((resolve) => {
    resolveShutdown = resolve;
  });
  const onSigterm = () => resolveShutdown("SIGTERM");
  const onSigint = () => resolveShutdown("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  const first = await Promise.race([running, shutdownRequested]);
  process.off("SIGTERM", onSigterm);
  process.off("SIGINT", onSigint);

  if (typeof first !== "string") {
    health.markNotReady();
    health.markStopping();
    controller.abort();
    if (first.status === "failed") {
      writeLog(
        "error",
        "processor_stopped_with_error",
        errorFields(first.error),
      );
    } else {
      writeLog("error", "processor_stopped_unexpectedly");
    }
    await closeHealthServer(healthServer).catch(() => undefined);
    return 1;
  }

  health.markStopping();
  controller.abort();
  writeLog("info", "shutdown_started", { signal: first });
  const drained = await waitForDrain(running, config.drainTimeoutMs);
  if (!drained) {
    writeLog("error", "shutdown_drain_timed_out", {
      drain_timeout_ms: config.drainTimeoutMs,
    });
    healthServer.closeAllConnections();
    await closeHealthServer(healthServer).catch(() => undefined);
    process.exit(1);
    return 1;
  }

  const outcome = await running;
  await closeHealthServer(healthServer).catch(() => undefined);
  if (outcome.status === "failed") {
    writeLog("error", "shutdown_drain_failed", errorFields(outcome.error));
    return 1;
  }
  writeLog("info", "shutdown_complete");
  return 0;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
