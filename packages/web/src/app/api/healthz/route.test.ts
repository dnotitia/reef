import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/healthz", () => {
  it("returns HTTP 200 with { status: 'ok' }", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("requires no authentication", () => {
    // Route handler takes no Request argument — liveness probe is auth-free
    const response = GET();
    expect(response.status).toBe(200);
  });
});
