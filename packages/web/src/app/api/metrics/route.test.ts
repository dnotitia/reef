import { describe, expect, it, vi } from "vitest";

// Mock the metrics module before importing the route so the registry singleton
// doesn't spin up prom-client's default metrics collector in the test process.
vi.mock("@/lib/metrics", () => ({
  registry: {
    metrics: vi.fn(async () =>
      [
        "# HELP reef_agent_loop_steps_total Total number of agent loop steps executed",
        "# TYPE reef_agent_loop_steps_total counter",
        "reef_agent_loop_steps_total 42",
        "",
      ].join("\n"),
    ),
    contentType: "text/plain; version=0.0.4; charset=utf-8",
  },
}));

import { GET } from "./route";

describe("GET /api/metrics", () => {
  it("returns 200 with Prometheus text format", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
  });

  it("returns Content-Type text/plain; version=0.0.4", async () => {
    const response = await GET();
    const contentType = response.headers.get("Content-Type") ?? "";
    expect(contentType).toContain("text/plain");
    expect(contentType).toContain("version=0.0.4");
  });

  it("returns a non-empty body with metric data", async () => {
    const response = await GET();
    const body = await response.text();
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain("reef_agent_loop_steps_total");
  });

  it("calls registry.metrics() to generate the response body", async () => {
    const { registry } = await import("@/lib/metrics");
    vi.mocked(registry.metrics).mockClear();

    await GET();

    expect(registry.metrics).toHaveBeenCalledOnce();
  });
});
