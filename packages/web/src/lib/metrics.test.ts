// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import {
  agentLoopStepsTotal,
  casConflictsTotal,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  registry,
  toolCallsTotal,
} from "./metrics";

describe("metrics singleton", () => {
  beforeEach(() => registry.resetMetrics());

  it("increments reef_http_requests_total with method and route_class labels", async () => {
    httpRequestsTotal.inc({ method: "GET", route_class: "/api/issues" });
    httpRequestsTotal.inc({ method: "POST", route_class: "/api/agents" });
    httpRequestsTotal.inc({ method: "GET", route_class: "/api/issues" });

    const output = await registry.metrics();
    expect(output).toContain(
      'reef_http_requests_total{method="GET",route_class="/api/issues"} 2\n',
    );
    expect(output).toContain(
      'reef_http_requests_total{method="POST",route_class="/api/agents"} 1\n',
    );
  });

  it("increments reef_agent_loop_steps_total correctly", async () => {
    agentLoopStepsTotal.inc();
    agentLoopStepsTotal.inc();

    expect(await registry.metrics()).toContain(
      "reef_agent_loop_steps_total 2\n",
    );
  });

  it("increments reef_tool_calls_total with correct tool_name label", async () => {
    toolCallsTotal.inc({ tool_name: "search_code" });
    toolCallsTotal.inc({ tool_name: "draft_issue" });
    toolCallsTotal.inc({ tool_name: "search_code" });

    const output = await registry.metrics();
    expect(output).toContain(
      'reef_tool_calls_total{tool_name="search_code"} 2\n',
    );
    expect(output).toContain(
      'reef_tool_calls_total{tool_name="draft_issue"} 1\n',
    );
  });

  it("increments reef_cas_conflicts_total correctly", async () => {
    casConflictsTotal.inc();

    expect(await registry.metrics()).toContain("reef_cas_conflicts_total 1\n");
  });

  it("observes reef_http_request_duration_seconds histogram correctly", async () => {
    httpRequestDurationSeconds.observe(
      { method: "GET", route_class: "/api/issues" },
      0.05,
    );
    httpRequestDurationSeconds.observe(
      { method: "POST", route_class: "/api/agents" },
      1.2,
    );

    const output = await registry.metrics();
    expect(output).toContain(
      'reef_http_request_duration_seconds_count{method="GET",route_class="/api/issues"} 1\n',
    );
    expect(output).toContain(
      'reef_http_request_duration_seconds_sum{method="GET",route_class="/api/issues"} 0.05\n',
    );
    expect(output).toContain(
      'reef_http_request_duration_seconds_bucket{le="0.025",method="GET",route_class="/api/issues"} 0\n',
    );
    expect(output).toContain(
      'reef_http_request_duration_seconds_bucket{le="0.05",method="GET",route_class="/api/issues"} 1\n',
    );
    expect(output).toContain(
      'reef_http_request_duration_seconds_count{method="POST",route_class="/api/agents"} 1\n',
    );
    expect(output).toContain(
      'reef_http_request_duration_seconds_sum{method="POST",route_class="/api/agents"} 1.2\n',
    );
    expect(output).toContain(
      'reef_http_request_duration_seconds_bucket{le="1",method="POST",route_class="/api/agents"} 0\n',
    );
    expect(output).toContain(
      'reef_http_request_duration_seconds_bucket{le="2.5",method="POST",route_class="/api/agents"} 1\n',
    );
  });

  it("registry.contentType includes text/plain", () => {
    expect(registry.contentType).toContain("text/plain");
  });
});
