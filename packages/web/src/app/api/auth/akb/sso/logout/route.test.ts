// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function makeRequest(cookie?: string, nonce = "logout-nonce"): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(
    `http://localhost/api/auth/akb/sso/logout?nonce=${nonce}`,
    {
      method: "GET",
      headers,
    },
  );
}

describe("GET /api/auth/akb/sso/logout", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("relays the public AKB/Keycloak logout redirect and clears auth cookies", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://idp.test/logout" },
      }),
    );

    const res = await GET(
      makeRequest(
        "__reef_sso_logout_id_token=id-token; __reef_sso_logout=logout-nonce",
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://idp.test/logout");

    const logoutUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(`${logoutUrl.origin}${logoutUrl.pathname}`).toBe(
      "http://akb.test/api/v1/auth/keycloak/logout",
    );
    expect(logoutUrl.search).toBe("");
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      id_token_hint: "id-token",
    });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__reef_session=");
    expect(setCookie).toContain("__reef_sso=");
    expect(setCookie).toContain("__reef_sso_id_token=");
    expect(setCookie).toContain("__reef_sso_start=");
    expect(setCookie).toContain("__reef_sso_logout=");
    expect(setCookie).toContain("__reef_sso_logout_id_token=");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("rejects the follow-up route when the logout nonce is absent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects the follow-up route when the logout nonce does not match", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(
      makeRequest(
        "__reef_sso_logout_id_token=id-token; __reef_sso_logout=logout-nonce",
        "wrong-nonce",
      ),
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to /login when AKB logout cannot provide a public redirect", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 404 }),
    );

    const res = await GET(
      makeRequest(
        "__reef_sso_logout_id_token=id-token; __reef_sso_logout=logout-nonce",
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});
