// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

/**
 * Redaction contract test.
 *
 * Synthesizes a request carrying known-fake `Authorization` and `X-Reef-LLM`
 * header values, drives it through the proxy, and asserts that neither token
 * substring ever appears in captured stdout/stderr output. If this test
 * fails, a credential leak path has been introduced into the request-logging
 * pipeline — block merge until resolved.
 */

const FAKE_GITHUB_TOKEN = "ghp_redaction_canary_1234567890";
const FAKE_LLM_HEADER = "eyJhcGlLZXkiOiJsbG1fY2FuYXJ5X3Rva2VuIn0="; // base64 placeholder
const FAKE_OAUTH_CODE = "oauth_authorization_code_canary_9876"; // SSO callback `code`

function captureOutput() {
  const sink: string[] = [];
  const push = (...args: unknown[]) => {
    sink.push(args.map(String).join(" "));
  };
  const logSpy = vi.spyOn(console, "log").mockImplementation(push);
  const errSpy = vi.spyOn(console, "error").mockImplementation(push);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(push);
  const infoSpy = vi.spyOn(console, "info").mockImplementation(push);
  // The proxy now logs through the shared pino `logger`, which under NODE_ENV
  // "test" writes JSON lines via a `process.stdout.write` shim (no transport).
  // Capture stdout too, so the redaction assertions see the real request line.
  const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: unknown,
  ) => {
    sink.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write);
  return {
    sink,
    restore: () => {
      logSpy.mockRestore();
      errSpy.mockRestore();
      warnSpy.mockRestore();
      infoSpy.mockRestore();
      stdoutSpy.mockRestore();
    },
  };
}

/** Build an unsigned (akb re-validates) session JWT carrying the given claims. */
function makeSessionJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${body}.sig-not-verified`;
}

/** The single parsed pino `request` line from captured stdout, if any. */
function requestLine(sink: string[]): Record<string, unknown> | undefined {
  return sink
    .join("")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .find((o): o is Record<string, unknown> => o?.msg === "request");
}

describe("proxy — credential redaction", () => {
  let capture: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    capture = captureOutput();
  });

  afterEach(() => {
    capture.restore();
  });

  it("never logs the Authorization header value", () => {
    const request = new NextRequest("https://reef.test/api/issues?repo=o/r", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${FAKE_GITHUB_TOKEN}`,
      },
    });

    proxy(request);

    const combined = capture.sink.join("\n");
    expect(combined).not.toContain(FAKE_GITHUB_TOKEN);
    expect(combined).not.toMatch(/Bearer\s/i);
    // Positive assertion: we DID emit sanitized metadata
    expect(combined).toContain('"method":"GET"');
    expect(combined).toContain('"path":"/api/issues"');
  });

  it("never logs the X-Reef-LLM header value", () => {
    const request = new NextRequest("https://reef.test/api/agents/runs", {
      method: "POST",
      headers: {
        "X-Reef-LLM": FAKE_LLM_HEADER,
      },
    });

    proxy(request);

    const combined = capture.sink.join("\n");
    expect(combined).not.toContain(FAKE_LLM_HEADER);
    expect(combined.toLowerCase()).not.toContain("x-reef-llm");
  });

  it("never logs both credential headers when both are present", () => {
    const request = new NextRequest("https://reef.test/api/issues", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${FAKE_GITHUB_TOKEN}`,
        "X-Reef-LLM": FAKE_LLM_HEADER,
        "Content-Type": "application/json",
      },
    });

    proxy(request);

    const combined = capture.sink.join("\n");
    expect(combined).not.toContain(FAKE_GITHUB_TOKEN);
    expect(combined).not.toContain(FAKE_LLM_HEADER);
  });

  it("never logs capitalized credential header values (case-insensitive)", () => {
    const secretKey = "sk-super-secret";
    const encoded = Buffer.from(
      JSON.stringify({
        api_key: secretKey,
        base_url: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      }),
    ).toString("base64");

    const request = new NextRequest("https://reef.test/api/agents/runs", {
      method: "POST",
      headers: {
        "X-Reef-LLM": encoded,
        "Content-Type": "application/json",
      },
    });

    proxy(request);

    const combined = capture.sink.join("\n");
    expect(combined).not.toContain(secretKey);
    expect(combined).not.toContain(encoded);
    // The proxy logs just sanitized metadata, not header values at all
    expect(combined.toLowerCase()).not.toContain("x-reef-llm");
  });

  it("never logs SSO callback query values — top-level or nested in redirect", () => {
    // The OAuth/SSO callback receives a one-time `code` and a CSRF `state` in the
    // query by protocol; the `redirect` value itself embeds a nested `state`
    // nonce. None of these param names are allowlisted, so values are dropped to
    // bare keys and no nonce/code — top-level or nested — can reach the log.
    const nestedRedirect = encodeURIComponent(
      "/login/sso-complete?state=nested-nonce-canary&next=/issues",
    );
    const request = new NextRequest(
      `https://reef.test/api/auth/akb/sso/callback?code=${FAKE_OAUTH_CODE}&state=csrf-nonce-canary&redirect=${nestedRedirect}`,
      { method: "GET" },
    );

    proxy(request);

    const combined = capture.sink.join("");
    expect(combined).not.toContain(FAKE_OAUTH_CODE);
    expect(combined).not.toContain("csrf-nonce-canary");
    expect(combined).not.toContain("nested-nonce-canary");
    expect(combined).not.toContain("sso-complete");
    // Param names are still logged (key) for debugging signal.
    expect(combined).toContain("?code&state&redirect");
  });

  it("preserves non-sensitive allowlisted query parameters (e.g. vault) in the log", () => {
    const request = new NextRequest(
      "https://reef.test/api/planning?vault=reef-test",
      { method: "GET" },
    );

    proxy(request);

    expect(capture.sink.join("")).toContain("?vault=reef-test");
  });

  it("emits structured request metadata through the shared pino logger", () => {
    const request = new NextRequest(
      "https://reef.test/api/issues?vault=reef-test",
      { method: "GET" },
    );

    proxy(request);

    const line = capture.sink
      .join("")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((o) => o?.msg === "request");

    expect(line).toBeTruthy();
    expect(line?.method).toBe("GET");
    expect(line?.path).toBe("/api/issues");
    expect(line?.query).toBe("?vault=reef-test");
    expect(line?.route_class).toBe("/api/issues");
    expect(line?.level).toBe(30); // pino info
    // pino injects an ISO 8601 `time` field (no separate `timestamp`).
    expect(line?.time as string).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("omits the query field when the URL has no query string", () => {
    const request = new NextRequest("https://reef.test/api/healthz", {
      method: "GET",
    });

    proxy(request);

    const line = capture.sink
      .join("")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((o) => o?.msg === "request");

    expect(line).toBeTruthy();
    expect(line).not.toHaveProperty("query");
  });

  it("stamps the request line with the akb actor from the session cookie (REEF-271)", () => {
    const jwt = makeSessionJwt({ sub: "alice-actor" });
    const request = new NextRequest("https://reef.test/api/issues", {
      method: "GET",
      headers: { cookie: `__reef_session=${jwt}` },
    });

    proxy(request);

    const line = requestLine(capture.sink);
    expect(line?.actor).toBe("alice-actor");
  });

  it("omits the actor field when there is no session cookie", () => {
    const request = new NextRequest("https://reef.test/api/issues", {
      method: "GET",
    });

    proxy(request);

    expect(requestLine(capture.sink)).not.toHaveProperty("actor");
  });

  it("logs only the decoded actor, never the raw session token", () => {
    // The JWT is itself a credential; just the `sub` identity claim should reach
    // the log. A canary rides the (unused) signature segment to prove the raw
    // token does not leaks while the actor is decoded.
    const jwt = `${makeSessionJwt({ sub: "alice-actor" })}.sig_token_canary_zzz`;
    const request = new NextRequest("https://reef.test/api/issues", {
      method: "GET",
      headers: { cookie: `__reef_session=${jwt}` },
    });

    proxy(request);

    const combined = capture.sink.join("");
    expect(combined).toContain('"actor":"alice-actor"');
    expect(combined).not.toContain("sig_token_canary_zzz");
    expect(combined).not.toContain(jwt);
  });

  it("matcher targets all non-static routes for CSP nonce coverage", async () => {
    const { config } = await import("./proxy");
    // Matcher covers all requests EXCEPT:
    //  - /_next/static, /_next/image, /favicon.ico (static assets)
    //  - /api/metrics (Prometheus scrape endpoint — machine-to-machine,
    //    excluded so CSP headers are not injected on every Prometheus poll)
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|favicon.ico|api/metrics).*)",
    ]);
  });

  it("does not emit request-logging on non-/api routes (nonce-only path)", () => {
    const request = new NextRequest("https://reef.test/board", {
      method: "GET",
    });

    proxy(request);

    const combined = capture.sink.join("");
    // No request log line should appear for page navigations — logging is
    // scoped to /api/* just to avoid per-navigation noise.
    expect(combined).not.toContain('"msg":"request"');
  });
});

describe("proxy — CSP nonce scaffold", () => {
  it("attaches an x-nonce header to the response for page navigations", () => {
    const request = new NextRequest("https://reef.test/board", {
      method: "GET",
    });

    const response = proxy(request);

    const nonce = response.headers.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(typeof nonce).toBe("string");
    expect(nonce?.length).toBeGreaterThan(0);
  });

  it("attaches an x-nonce header to /api/* responses as well", () => {
    const request = new NextRequest("https://reef.test/api/issues?repo=o/r", {
      method: "GET",
    });

    const response = proxy(request);

    expect(response.headers.get("x-nonce")).toBeTruthy();
  });

  it("generates a different nonce for each request", () => {
    const r1 = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const r2 = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const n1 = r1.headers.get("x-nonce");
    const n2 = r2.headers.get("x-nonce");
    expect(n1).toBeTruthy();
    expect(n2).toBeTruthy();
    expect(n1).not.toBe(n2);
  });
});

/**
 * CSP regression audit.
 *
 * These tests parse the Content-Security-Policy header emitted by the proxy
 * and assert the security invariants required by the proxy contract:
 *   - No `unsafe-inline` in `script-src` (XSS mitigation)
 *   - No third-party `script-src` origins (token exfiltration prevention)
 *   - `default-src 'self'` present (safe default for unlisted types)
 *   - Nonce in CSP header matches `x-nonce` response header (no split-brain)
 *
 * If any of these assertions fail, a security regression has been introduced —
 * block merge until resolved.
 */
describe("proxy — CSP header audit", () => {
  it("sets a Content-Security-Policy header on every response", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(typeof csp).toBe("string");
  });

  it("sets Content-Security-Policy on /api/* responses as well", () => {
    const response = proxy(
      new NextRequest("https://reef.test/api/issues?repo=o/r", {
        method: "GET",
      }),
    );

    expect(response.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("does NOT contain unsafe-inline in script-src (XSS regression gate)", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";

    // Extract the script-src directive
    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
    expect(scriptSrcMatch).toBeTruthy();
    const scriptSrc = scriptSrcMatch?.[1] ?? "";

    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("does NOT whitelist any third-party script-src origins", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";

    // Allowed origins in script-src: 'self', 'nonce-...', 'strict-dynamic',
    // a hash, and — in development just — 'unsafe-eval' for React's dev
    // error-overlay eval calls. No third-party origins permitted.
    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
    const scriptSrc = scriptSrcMatch?.[1] ?? "";

    // Split on whitespace to get individual tokens
    const tokens = scriptSrc.trim().split(/\s+/);
    for (const token of tokens) {
      const isAllowed =
        token === "'self'" ||
        token === "'strict-dynamic'" ||
        token === "'unsafe-eval'" || // dev; guarded by process.env.NODE_ENV in proxy.ts
        /^'nonce-[A-Za-z0-9+/]+=*'$/.test(token) ||
        /^'sha(256|384|512)-/.test(token);
      expect(
        isAllowed,
        `Unexpected script-src token "${token}" — third-party origins are not allowed on authenticated routes`,
      ).toBe(true);
    }
  });

  it("does not emits 'unsafe-eval' in production (NODE_ENV guard)", () => {
    // Vitest runs with NODE_ENV !== "development" by default; this test
    // asserts the dev-mode escape hatch is NOT present outside development.
    // If NODE_ENV is "development" locally, skip — the CI guard still covers
    // protected branches where NODE_ENV is "test" or "production".
    if (process.env.NODE_ENV === "development") return;

    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
    const scriptSrc = scriptSrcMatch?.[1] ?? "";
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("includes 'strict-dynamic' in script-src to allow nonce-stamped loader chunks", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
    const scriptSrc = scriptSrcMatch?.[1] ?? "";
    expect(scriptSrc).toContain("'strict-dynamic'");
  });

  it("propagates the nonce onto the REQUEST headers so Next.js stamps framework scripts", () => {
    // The key invariant: x-nonce and Content-Security-Policy should be on the
    // REQUEST headers (forwarded via NextResponse.next({ request: { headers } }))
    // so Next.js SSR can discover the nonce and auto-attach it to its own
    // script tags. Without this, strict CSP blocks the Next.js runtime.
    //
    // NextResponse doesn't expose the forwarded request headers through a
    // public API, but the presence of the `x-middleware-override-headers`
    // and `x-middleware-request-x-nonce` pair on the response signals that
    // the request-header override is wired up.
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const override = response.headers.get("x-middleware-override-headers");
    expect(override).toBeTruthy();
    expect(override).toContain("x-nonce");
    expect(override).toContain("content-security-policy");
  });

  it("includes form-action 'self' to prevent credential exfiltration via form hijack", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("form-action 'self'");
  });

  it("includes frame-ancestors 'none' to block clickjacking", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("includes upgrade-insecure-requests to auto-upgrade http subresources", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("includes default-src 'self' as a safe fallback directive", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
  });

  it("nonce value in CSP script-src matches the x-nonce response header", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const nonce = response.headers.get("x-nonce");
    const csp = response.headers.get("Content-Security-Policy") ?? "";

    expect(nonce).toBeTruthy();
    // The CSP should include 'nonce-{nonce}' with quotes
    expect(csp).toContain(`'nonce-${nonce}'`);
  });

  it("includes object-src 'none' to block plugin execution", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("object-src 'none'");
  });

  it("includes base-uri 'self' to prevent <base> tag hijacking", () => {
    const response = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const csp = response.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("base-uri 'self'");
  });

  it("emits a different nonce-bearing CSP for each request", () => {
    const r1 = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );
    const r2 = proxy(
      new NextRequest("https://reef.test/board", { method: "GET" }),
    );

    const csp1 = r1.headers.get("Content-Security-Policy") ?? "";
    const csp2 = r2.headers.get("Content-Security-Policy") ?? "";

    // CSPs should differ because nonces differ
    expect(csp1).not.toBe(csp2);
  });
});
