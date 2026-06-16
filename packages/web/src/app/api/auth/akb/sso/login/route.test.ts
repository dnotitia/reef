// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function makeRequest(redirect: string): Request {
  const params = new URLSearchParams({ redirect });
  return new Request(
    `http://localhost/api/auth/akb/sso/login?${params.toString()}`,
    { method: "GET" },
  );
}

function makeCallbackPath(state = "nonce-1"): string {
  const completionParams = new URLSearchParams({
    state,
    next: "/issues",
  });
  const callbackParams = new URLSearchParams({
    redirect: `/login/sso-complete?${completionParams.toString()}`,
  });
  return `/api/auth/akb/sso/callback?${callbackParams.toString()}`;
}

describe("GET /api/auth/akb/sso/login", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://backend.akb.svc.cluster.local:8000");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("relays the public Keycloak redirect without exposing AKB_BACKEND_URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            keycloak: {
              enabled: true,
              login_url: "/api/v1/auth/keycloak/login",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://idp.test/login?state=abc" },
        }),
      );

    const callbackPath = makeCallbackPath();
    const res = await GET(makeRequest(callbackPath));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "https://idp.test/login?state=abc",
    );
    expect(res.headers.get("location")).not.toContain(
      "backend.akb.svc.cluster.local",
    );

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://backend.akb.svc.cluster.local:8000/api/v1/auth/config",
      expect.objectContaining({ method: "GET" }),
    );
    const loginUrl = new URL(String(fetchSpy.mock.calls[1]?.[0]));
    expect(`${loginUrl.origin}${loginUrl.pathname}`).toBe(
      "http://backend.akb.svc.cluster.local:8000/api/v1/auth/keycloak/login",
    );
    expect(loginUrl.searchParams.get("redirect")).toBe(callbackPath);
    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      method: "GET",
      redirect: "manual",
    });
  });

  it("rejects non-callback redirects before contacting akb", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(makeRequest("/api/auth/akb/sso/callback"));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=invalid_sso_state",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("redirects to login when SSO is disabled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ keycloak: { enabled: false, login_url: null } }),
        { status: 200 },
      ),
    );

    const res = await GET(makeRequest(makeCallbackPath()));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?sso_error=sso_disabled");
    expect(res.headers.get("set-cookie")).toContain("__reef_sso_start=");
  });

  it("does not relay relative upstream redirects to the browser", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            keycloak: {
              enabled: true,
              login_url: "/api/v1/auth/keycloak/login",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/realms/reef/protocol/openid-connect/auth" },
        }),
      );

    const res = await GET(makeRequest(makeCallbackPath()));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=backend_unconfigured",
    );
  });

  it("prefixes REEF_PUBLIC_ORIGIN so akb receives an absolute self-origin callback (companion mode)", async () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef-acme.example.com");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            keycloak: {
              enabled: true,
              login_url: "/api/v1/auth/keycloak/login",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://idp.test/login?state=abc" },
        }),
      );

    const callbackPath = makeCallbackPath();
    const res = await GET(makeRequest(callbackPath));

    expect(res.status).toBe(302);
    const loginUrl = new URL(String(fetchSpy.mock.calls[1]?.[0]));
    // The origin is the configured constant, not request.url (localhost).
    expect(loginUrl.searchParams.get("redirect")).toBe(
      `https://reef-acme.example.com${callbackPath}`,
    );
  });

  it("rejects an inbound ABSOLUTE redirect even when REEF_PUBLIC_ORIGIN is set (origin never comes from input)", async () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef-acme.example.com");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(
      makeRequest(
        "https://reef-acme.example.com/api/auth/akb/sso/callback?redirect=%2Flogin%2Fsso-complete%3Fstate%3Dnonce-1%26next%3D%2Fissues",
      ),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=invalid_sso_state",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a scheme-relative inbound redirect", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(
      makeRequest("//evil.example.com/api/auth/akb/sso/callback"),
    );

    expect(res.headers.get("location")).toBe(
      "/login?sso_error=invalid_sso_state",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed with sso_misconfigured when REEF_PUBLIC_ORIGIN is malformed", async () => {
    vi.stubEnv("REEF_PUBLIC_ORIGIN", "https://reef-acme.example.com/has/path");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(makeRequest(makeCallbackPath()));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=sso_misconfigured",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
