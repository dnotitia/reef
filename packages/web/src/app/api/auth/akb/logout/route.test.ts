// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/akb/logout", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REEF_AUTH_MODE", "local");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("clears every established auth carrier for local logout", async () => {
    const response = await POST(
      new Request("http://localhost/api/auth/akb/logout", { method: "POST" }),
    );
    expect(response.status).toBe(204);
    for (const name of ["__reef_session", "__reef_auth_v2"]) {
      const cookie = response.headers
        .getSetCookie()
        .find((value) => value.startsWith(`${name}=`));
      expect(cookie?.split(";")[0]).toBe(`${name}=`);
      expect(cookie?.split("; ")).toContain("Max-Age=0");
    }
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not call AKB during local cookie cleanup", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await POST(
      new Request("http://localhost/api/auth/akb/logout", { method: "POST" }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
