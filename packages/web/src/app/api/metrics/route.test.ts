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
  it("returns 200 with the registry bytes in Prometheus text format", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(await response.text()).toBe(
      [
        "# HELP reef_agent_loop_steps_total Total number of agent loop steps executed",
        "# TYPE reef_agent_loop_steps_total counter",
        "reef_agent_loop_steps_total 42",
        "",
      ].join("\n"),
    );
  });
});
