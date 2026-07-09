import type { AkbAdapter, GitHubAdapter, LlmAdapter } from "@reef/core";
import { type OrchestratorConfig, publicOrchestratorConfig } from "./config.js";

export interface OrchestratorDomainPorts {
  akb?: AkbAdapter;
  github?: GitHubAdapter;
  llm?: LlmAdapter;
}

export interface OrchestratorLogEvent {
  event: string;
  [key: string]: unknown;
}

export interface OrchestratorLogger {
  info: (event: OrchestratorLogEvent) => void;
  warn: (event: OrchestratorLogEvent) => void;
  error: (event: OrchestratorLogEvent) => void;
}

export interface OrchestratorTickContext {
  config: OrchestratorConfig;
  ports: OrchestratorDomainPorts;
  signal: AbortSignal;
}

export interface OrchestratorTickResult {
  startedWork: boolean;
}

export type OrchestratorTick = (
  context: OrchestratorTickContext,
) => Promise<OrchestratorTickResult> | OrchestratorTickResult;

export interface RunOrchestratorOptions {
  logger?: OrchestratorLogger;
  ports?: OrchestratorDomainPorts;
  signal?: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  tick?: OrchestratorTick;
  now?: () => Date;
}

export interface OrchestratorRunSummary {
  status: "ready" | "stopped";
  reason: "dry_run" | "signal";
  mode: OrchestratorConfig["mode"];
  vault: string;
  startedAt: string;
  stoppedAt: string;
  ticks: number;
  claimsAttempted: number;
}

const jsonLogger: OrchestratorLogger = {
  info: (event) => console.log(JSON.stringify(event)),
  warn: (event) => console.warn(JSON.stringify(event)),
  error: (event) => console.error(JSON.stringify(event)),
};

export const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

const idleTick: OrchestratorTick = () => ({ startedWork: false });

export async function runOrchestrator(
  config: OrchestratorConfig,
  {
    logger = jsonLogger,
    ports = {},
    signal = new AbortController().signal,
    sleep: sleepFn = sleep,
    tick = idleTick,
    now = () => new Date(),
  }: RunOrchestratorOptions = {},
): Promise<OrchestratorRunSummary> {
  const startedAt = now().toISOString();
  let ticks = 0;
  let claimsAttempted = 0;

  logger.info({
    event: "orchestrator.started",
    config: publicOrchestratorConfig(config),
    startedAt,
  });

  if (config.dryRun) {
    const stoppedAt = now().toISOString();
    logger.info({
      event: "orchestrator.ready",
      mode: config.mode,
      vault: config.vault,
      claimsAttempted,
      stoppedAt,
    });
    return {
      status: "ready",
      reason: "dry_run",
      mode: config.mode,
      vault: config.vault,
      startedAt,
      stoppedAt,
      ticks,
      claimsAttempted,
    };
  }

  while (!signal.aborted) {
    const tickResult = await tick({ config, ports, signal });
    ticks += 1;
    if (tickResult.startedWork) claimsAttempted += 1;
    if (signal.aborted) break;
    await sleepFn(config.pollIntervalMs, signal);
  }

  const stoppedAt = now().toISOString();
  logger.info({
    event: "orchestrator.stopped",
    reason: "signal",
    mode: config.mode,
    vault: config.vault,
    ticks,
    claimsAttempted,
    stoppedAt,
  });

  return {
    status: "stopped",
    reason: "signal",
    mode: config.mode,
    vault: config.vault,
    startedAt,
    stoppedAt,
    ticks,
    claimsAttempted,
  };
}
