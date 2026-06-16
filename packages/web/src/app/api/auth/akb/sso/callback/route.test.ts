// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const SESSION_COOKIE = "__reef_session";
const SSO_ID_TOKEN_COOKIE = "__reef_sso_id_token";
const SSO_SESSION_COOKIE = "__reef_sso";
const SSO_START_COOKIE = "__reef_sso_start";

function makeJwt(payload: object): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig-not-verified`;
}

const futureExp = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
const VALID_JWT = makeJwt({ exp: futureExp, sub: "user-1" });
const VALID_USER = {
  id: "user-1",
  username: "alice",
  email: "alice@example.com",
  display_name: "Alice",
  is_admin: false,
};

function makeCompletionPath(state = "nonce-1", next = "/issues"): string {
  const params = new URLSearchParams({ state, next });
  return `/login/sso-complete?${params.toString()}`;
}

function makeNestedCallbackPath(state = "nonce-1", next = "/issues"): string {
  const params = new URLSearchParams({
    redirect: makeCompletionPath(state, next),
  });
  return `/api/auth/akb/sso/callback?${params.toString()}`;
}

function makeCallbackRequest(options: {
  code?: string;
  redirect?: string;
  cookie?: string;
}): Request {
  const params = new URLSearchParams();
  if (options.code) params.set("code", options.code);
  if (options.redirect) params.set("redirect", options.redirect);
  return new Request(
    `http://localhost/api/auth/akb/sso/callback?${params.toString()}`,
    {
      method: "GET",
      headers: options.cookie ? { cookie: options.cookie } : undefined,
    },
  );
}

describe("GET /api/auth/akb/sso/callback", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exchanges code server-side, sets session cookies, and redirects to completion", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: VALID_JWT,
          user: VALID_USER,
          kc_id_token: "keycloak-id-token",
        }),
        { status: 200 },
      ),
    );
    const completionPath = makeCompletionPath("nonce-1", "/issues?status=open");

    const res = await GET(
      makeCallbackRequest({
        code: "one-time-code",
        redirect: completionPath,
        cookie: `${SSO_START_COOKIE}=nonce-1`,
      }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(completionPath);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toContain(`${SSO_SESSION_COOKIE}=1`);
    expect(setCookie).toContain(`${SSO_ID_TOKEN_COOKIE}=keycloak-id-token`);
    expect(setCookie).toContain(`${SSO_START_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).not.toContain("one-time-code");

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/keycloak/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "one-time-code" }),
      }),
    );
  });

  it("accepts an echoed callback redirect that nests the completion path", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ token: VALID_JWT, user: VALID_USER }), {
        status: 200,
      }),
    );

    const res = await GET(
      makeCallbackRequest({
        code: "one-time-code",
        redirect: makeNestedCallbackPath("nonce-1", "/issues?status=open"),
        cookie: `${SSO_START_COOKIE}=nonce-1`,
      }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      makeCompletionPath("nonce-1", "/issues?status=open"),
    );
  });

  it("clears a stale SSO id token when the exchange response omits one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          token: VALID_JWT,
          user: VALID_USER,
        }),
        { status: 200 },
      ),
    );

    const res = await GET(
      makeCallbackRequest({
        code: "one-time-code",
        redirect: makeCompletionPath("nonce-1", "/issues"),
        cookie: `${SSO_START_COOKIE}=nonce-1; ${SSO_ID_TOKEN_COOKIE}=old-token`,
      }),
    );

    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${SSO_ID_TOKEN_COOKIE}=`);
    expect(setCookie).toContain("Max-Age=0");
    expect(setCookie).not.toContain("old-token");
  });

  it("redirects to missing_code without calling akb when code is absent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(
      makeCallbackRequest({
        redirect: makeCompletionPath(),
        cookie: `${SSO_START_COOKIE}=nonce-1`,
      }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?sso_error=missing_code");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toContain(`${SSO_START_COOKIE}=`);
  });

  it("redirects to invalid_sso_state on missing or mismatched nonce", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const res = await GET(
      makeCallbackRequest({
        code: "one-time-code",
        redirect: makeCompletionPath("nonce-1"),
        cookie: `${SSO_START_COOKIE}=different`,
      }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=invalid_sso_state",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects unsafe completion next paths", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const unsafeCompletion = makeCompletionPath("nonce-1", "//evil.example");

    const res = await GET(
      makeCallbackRequest({
        code: "one-time-code",
        redirect: unsafeCompletion,
        cookie: `${SSO_START_COOKIE}=nonce-1`,
      }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=invalid_sso_state",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("redirects to exchange_failed when akb rejects the code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "bad code" }), { status: 400 }),
    );

    const res = await GET(
      makeCallbackRequest({
        code: "bad-code",
        redirect: makeCompletionPath(),
        cookie: `${SSO_START_COOKIE}=nonce-1`,
      }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      "/login?sso_error=exchange_failed",
    );
    expect(res.headers.get("set-cookie")).toContain(`${SSO_START_COOKIE}=`);
  });
});
