// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

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

function makeLoginRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/akb/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/auth/akb/login", () => {
  beforeEach(() => {
    vi.stubEnv("AKB_BACKEND_URL", "http://akb.test");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 200 with user and sets __reef_session cookie on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ token: VALID_JWT, user: VALID_USER }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const res = await POST(
      makeLoginRequest({ username: "alice", password: "hunter2" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: unknown };
    expect(body).toEqual({ user: VALID_USER });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/__reef_session=/);
    expect(setCookie).toContain("__reef_sso=");
    expect(setCookie).toContain("__reef_sso_id_token=");
    expect(setCookie).toContain("__reef_sso_start=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");

    // body should not leak the JWT
    expect(JSON.stringify(body)).not.toContain(VALID_JWT);

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://akb.test/api/v1/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns 400 on invalid JSON body", async () => {
    const req = new Request("http://localhost/api/auth/akb/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when username or password missing", async () => {
    const res = await POST(makeLoginRequest({ username: "alice" }));
    expect(res.status).toBe(400);
  });

  it("returns 401 on akb backend 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Invalid credentials" }), {
        status: 401,
      }),
    );
    const res = await POST(
      makeLoginRequest({ username: "alice", password: "wrong" }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid/i);
  });

  it("returns 422 on akb backend 422", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("{}", { status: 422 }),
    );
    const res = await POST(
      makeLoginRequest({ username: "alice", password: "x" }),
    );
    expect(res.status).toBe(422);
  });

  it("returns 502 on akb backend 5xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("upstream down", { status: 503 }),
    );
    const res = await POST(
      makeLoginRequest({ username: "alice", password: "p" }),
    );
    expect(res.status).toBe(502);
  });

  it("returns 502 when akb backend response shape is unexpected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ wrong: "shape" }), { status: 200 }),
    );
    const res = await POST(
      makeLoginRequest({ username: "alice", password: "p" }),
    );
    expect(res.status).toBe(502);
  });

  it("returns 502 on fetch network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("ECONNREFUSED"),
    );
    const res = await POST(
      makeLoginRequest({ username: "alice", password: "p" }),
    );
    expect(res.status).toBe(502);
  });

  it("returns 503 when AKB_BACKEND_URL is not set", async () => {
    vi.stubEnv("AKB_BACKEND_URL", "");
    const res = await POST(
      makeLoginRequest({ username: "alice", password: "p" }),
    );
    expect(res.status).toBe(503);
  });

  it("Set-Cookie Max-Age is capped at 24h even if JWT exp is further out", async () => {
    const farJwt = makeJwt({
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ token: farJwt, user: VALID_USER }), {
        status: 200,
      }),
    );
    const res = await POST(
      makeLoginRequest({ username: "alice", password: "p" }),
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    const match = /Max-Age=(\d+)/.exec(setCookie);
    expect(match).toBeTruthy();
    expect(Number(match?.[1])).toBeLessThanOrEqual(60 * 60 * 24);
  });
});
