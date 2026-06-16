// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  agentLoopStepsTotal,
  casConflictsTotal,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  registry,
  toolCallsTotal,
} from "./metrics";

/**
 * Unit tests for the prom-client metrics singleton.
 *
 * Strategy: import the module, call the exported increment helpers, and assert
 * that registry.getSingleMetric().get() reflects the incremented values.
 *
 * Note: prom-client counters accumulate across test cases in the same process
 * because the singleton is module-level. Tests use relative assertions
 * (beforeValue + delta) rather than absolute values to remain order-independent.
 */

describe("metrics singleton", () => {
  it("exports a Registry instance", () => {
    expect(registry).toBeDefined();
    expect(typeof registry.metrics).toBe("function");
  });

  it("registers reef_http_requests_total counter", () => {
    const metric = registry.getSingleMetric("reef_http_requests_total");
    expect(metric).toBeDefined();
  });

  it("registers reef_http_request_duration_seconds histogram", () => {
    const metric = registry.getSingleMetric(
      "reef_http_request_duration_seconds",
    );
    expect(metric).toBeDefined();
  });

  it("registers reef_agent_loop_steps_total counter", () => {
    const metric = registry.getSingleMetric("reef_agent_loop_steps_total");
    expect(metric).toBeDefined();
  });

  it("registers reef_tool_calls_total counter", () => {
    const metric = registry.getSingleMetric("reef_tool_calls_total");
    expect(metric).toBeDefined();
  });

  it("registers reef_cas_conflicts_total counter", () => {
    const metric = registry.getSingleMetric("reef_cas_conflicts_total");
    expect(metric).toBeDefined();
  });

  it("increments reef_http_requests_total with method and route_class labels", async () => {
    httpRequestsTotal.inc({ method: "GET", route_class: "/api/issues" });
    httpRequestsTotal.inc({ method: "POST", route_class: "/api/chat" });
    httpRequestsTotal.inc({ method: "GET", route_class: "/api/issues" });

    const allMetrics = await registry.metrics();
    expect(allMetrics).toContain('method="GET"');
    expect(allMetrics).toContain('route_class="/api/issues"');
    expect(allMetrics).toContain('route_class="/api/chat"');
  });

  it("increments reef_agent_loop_steps_total correctly", async () => {
    const metric = registry.getSingleMetric("reef_agent_loop_steps_total");
    const before = (await metric?.get())?.values[0]?.value ?? 0;

    agentLoopStepsTotal.inc();
    agentLoopStepsTotal.inc();

    const after = (await metric?.get())?.values[0]?.value ?? 0;
    expect(after - before).toBe(2);
  });

  it("increments reef_tool_calls_total with correct tool_name label", async () => {
    toolCallsTotal.inc({ tool_name: "search_code" });
    toolCallsTotal.inc({ tool_name: "draft_issue" });
    toolCallsTotal.inc({ tool_name: "search_code" });

    const allMetrics = await registry.metrics();
    // The text format includes label-value pairs in curly braces
    expect(allMetrics).toContain('tool_name="search_code"');
    expect(allMetrics).toContain('tool_name="draft_issue"');
  });

  it("increments reef_cas_conflicts_total correctly", async () => {
    const metric = registry.getSingleMetric("reef_cas_conflicts_total");
    const before = (await metric?.get())?.values[0]?.value ?? 0;

    casConflictsTotal.inc();

    const after = (await metric?.get())?.values[0]?.value ?? 0;
    expect(after - before).toBe(1);
  });

  it("observes reef_http_request_duration_seconds histogram correctly", async () => {
    httpRequestDurationSeconds.observe(
      { method: "GET", route_class: "/api/issues" },
      0.05,
    );
    httpRequestDurationSeconds.observe(
      { method: "POST", route_class: "/api/chat" },
      1.2,
    );

    const allMetrics = await registry.metrics();
    expect(allMetrics).toContain("reef_http_request_duration_seconds_bucket");
    expect(allMetrics).toContain('route_class="/api/issues"');
  });

  it("registry.metrics() returns a non-empty string", async () => {
    const output = await registry.metrics();
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("registry.contentType includes text/plain", () => {
    expect(registry.contentType).toContain("text/plain");
  });
});
