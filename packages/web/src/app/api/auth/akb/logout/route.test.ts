// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

function makeRequest(cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/auth/akb/logout", {
    method: "POST",
    headers,
  });
}

describe("POST /api/auth/akb/logout", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 204 and clears reef auth cookies", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(204);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__reef_session=");
    expect(setCookie).toContain("__reef_sso=");
    expect(setCookie).toContain("__reef_sso_id_token=");
    expect(setCookie).toContain("__reef_sso_start=");
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
  });

  it("does NOT call the akb backend (no fetch issued)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await POST(makeRequest());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sets Cache-Control: no-store", async () => {
    const res = await POST(makeRequest());
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an SSO logout redirect URL while preserving the id token hint for the follow-up route", async () => {
    const res = await POST(
      makeRequest("__reef_sso=1; __reef_sso_id_token=id-token"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const redirectUrl = new URL(body.redirectUrl, "http://localhost");
    expect(redirectUrl.pathname).toBe("/api/auth/akb/sso/logout");
    expect(redirectUrl.searchParams.get("nonce")).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__reef_session=");
    expect(setCookie).toContain("__reef_sso=");
    expect(setCookie).toContain("__reef_sso_start=");
    expect(setCookie).toContain("__reef_sso_id_token=");
    expect(setCookie).toContain("__reef_sso_logout=");
    expect(setCookie).toContain("__reef_sso_logout_id_token=id-token");
    expect(setCookie).toContain("Max-Age=60");
    expect(setCookie).toContain("Max-Age=0");
  });
});
