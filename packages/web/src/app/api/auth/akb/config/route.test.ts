// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function makeRequest(): Request {
  return new Request("http://localhost/api/auth/akb/config", {
    method: "GET",
  });
}

describe("GET /api/auth/akb/config", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns public Keycloak config without requiring a session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          keycloak: {
            enabled: true,
            login_url: "/api/v1/auth/keycloak/login",
          },
        }),
        { status: 200 },
      ),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keycloak: {
        enabled: true,
        login_url: "/api/v1/auth/keycloak/login",
      },
    });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/config",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns 503 when AKB_BACKEND_URL is missing", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "");

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
  });

  it("returns 502 when akb config fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream down", { status: 503 }),
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
  });
});
