import { describe, expect, it } from "vitest";
import type { OrchestratorConfig } from "./config.js";
import {
  type OrchestratorLogEvent,
  type OrchestratorLogger,
  runOrchestrator,
} from "./loop.js";

const baseConfig: OrchestratorConfig = {
  mode: "idle",
  dryRun: false,
  vault: "reef-test",
  pollIntervalMs: 10,
  shutdownGraceMs: 10,
  akbBaseUrl: null,
  llm: null,
  githubApp: null,
};

const captureLogger = () => {
  const events: OrchestratorLogEvent[] = [];
  const logger: OrchestratorLogger = {
    info: (event) => events.push(event),
    warn: (event) => events.push(event),
    error: (event) => events.push(event),
  };
  return { logger, events };
};

describe("runOrchestrator", () => {
  it("reports readiness in dry-run mode without trying to claim work", async () => {
    const { logger, events } = captureLogger();
    let tickCount = 0;

    const summary = await runOrchestrator(
      { ...baseConfig, mode: "dry-run", dryRun: true },
      {
        logger,
        tick: () => {
          tickCount += 1;
          return { startedWork: true };
        },
      },
    );

    expect(summary).toMatchObject({
      status: "ready",
      reason: "dry_run",
      ticks: 0,
      claimsAttempted: 0,
    });
    expect(tickCount).toBe(0);
    expect(events.map((event) => event.event)).toEqual([
      "orchestrator.started",
      "orchestrator.ready",
    ]);
  });

  it("does not start work when shutdown has already been requested", async () => {
    const controller = new AbortController();
    controller.abort("SIGTERM");
    const { logger } = captureLogger();
    let tickCount = 0;

    const summary = await runOrchestrator(baseConfig, {
      logger,
      signal: controller.signal,
      tick: () => {
        tickCount += 1;
        return { startedWork: true };
      },
    });

    expect(summary).toMatchObject({
      status: "stopped",
      reason: "signal",
      ticks: 0,
      claimsAttempted: 0,
    });
    expect(tickCount).toBe(0);
  });

  it("does not schedule another tick after a shutdown signal arrives", async () => {
    const controller = new AbortController();
    const { logger } = captureLogger();
    let tickCount = 0;

    const summary = await runOrchestrator(baseConfig, {
      logger,
      signal: controller.signal,
      tick: () => {
        tickCount += 1;
        return { startedWork: false };
      },
      sleep: async () => {
        controller.abort("SIGTERM");
      },
    });

    expect(summary).toMatchObject({
      status: "stopped",
      reason: "signal",
      ticks: 1,
      claimsAttempted: 0,
    });
    expect(tickCount).toBe(1);
  });
});
