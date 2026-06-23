// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLoggerOptions, logger } from "./logger";

/**
 * Redaction + structure contract tests for the pino-based backend logger.
 *
 * The load-bearing invariant: credential values does not appear in emitted output.
 * Safety lives in the pino instance config (redact + serializers.err), so the
 * raw `logger` is safe to use directly — these tests exercise `logger.info` and
 * `logger.error` directly (there is no facade). pino writes through a stdout
 * shim (see logger.ts), so we capture `process.stdout.write` rather
 * than `console`.
 *
 * The canary token constants match proxy.test.ts for grep-ability across the
 * test suite.
 */

const FAKE_GITHUB_TOKEN = "ghp_redaction_canary_1234567890"; // same as proxy.test.ts
const FAKE_LLM_HEADER = "eyJhcGlLZXkiOiJsbG1fY2FuYXJ5X3Rva2VuIn0="; // same as proxy.test.ts

function captureStdout() {
  const sink: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
    chunk: unknown,
  ) => {
    sink.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write);
  return { sink, restore: () => spy.mockRestore() };
}

function logLines(sink: string[]): Array<Record<string, unknown>> {
  return sink
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("logger.info — credential header redaction (config-level)", () => {
  let capture: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    capture = captureStdout();
  });

  afterEach(() => {
    capture.restore();
  });

  it("redacts an Authorization header value — token substring absent from stdout", () => {
    logger.info(
      {
        method: "GET",
        path: "/api/issues",
        headers: {
          authorization: `Bearer ${FAKE_GITHUB_TOKEN}`,
          "content-type": "application/json",
        },
      },
      "request",
    );

    const combined = capture.sink.join("");
    expect(combined).not.toContain(FAKE_GITHUB_TOKEN);
    expect(combined).not.toMatch(/Bearer\s/i);
    const [line] = logLines(capture.sink);
    expect((line.headers as Record<string, string>).authorization).toBe(
      "[REDACTED]",
    );
  });

  it("redacts canonically-cased credential headers (Authorization, Cookie)", () => {
    logger.info(
      {
        headers: {
          Authorization: `Bearer ${FAKE_GITHUB_TOKEN}`,
          Cookie: "session=secret-value",
          "Content-Type": "application/json",
        },
      },
      "request",
    );

    const combined = capture.sink.join("");
    expect(combined).not.toContain(FAKE_GITHUB_TOKEN);
    expect(combined).not.toContain("session=secret-value");
    const [line] = logLines(capture.sink);
    const headers = line.headers as Record<string, string>;
    expect(headers.Authorization).toBe("[REDACTED]");
    expect(headers.Cookie).toBe("[REDACTED]");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("redacts an X-Reef-LLM header value", () => {
    logger.info({ headers: { "x-reef-llm": FAKE_LLM_HEADER } }, "request");

    const combined = capture.sink.join("");
    expect(combined).not.toContain(FAKE_LLM_HEADER);
    const [line] = logLines(capture.sink);
    expect((line.headers as Record<string, string>)["x-reef-llm"]).toBe(
      "[REDACTED]",
    );
  });

  it("redacts both Authorization and X-Reef-LLM when both are present", () => {
    logger.info(
      {
        headers: {
          authorization: `Bearer ${FAKE_GITHUB_TOKEN}`,
          "x-reef-llm": FAKE_LLM_HEADER,
        },
      },
      "request",
    );

    const combined = capture.sink.join("");
    expect(combined).not.toContain(FAKE_GITHUB_TOKEN);
    expect(combined).not.toContain(FAKE_LLM_HEADER);
  });

  it("emits structured JSON with safe fields (msg, level, time)", () => {
    logger.info({ method: "GET", path: "/api/issues" }, "request");

    const [line] = logLines(capture.sink);
    expect(line.method).toBe("GET");
    expect(line.path).toBe("/api/issues");
    expect(line.msg).toBe("request");
    expect(line.level).toBe(30);
    expect(line.time as string).toMatch(ISO_8601);
  });
});

describe("logger.error — safe direct use (config-level error serializer)", () => {
  let capture: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    capture = captureStdout();
  });

  afterEach(() => {
    capture.restore();
  });

  it("does not serialize nested error properties that may carry credentials", () => {
    // Octokit RequestError-shaped object: a credential rides on a nested
    // `request.headers.authorization` that top-level header redaction does not see.
    // The config `serializers.err` projects to name/message/stack just, so a
    // raw `logger.error({ err })` call is safe — no facade required.
    const err = Object.assign(new Error("Bad credentials"), {
      status: 401,
      request: {
        headers: { authorization: `token ${FAKE_GITHUB_TOKEN}` },
      },
      response: { data: { token: FAKE_GITHUB_TOKEN } },
    });

    logger.error({ err, route: "GET /api/repos" }, "list_repos failed");

    const combined = capture.sink.join("");
    expect(combined).not.toContain(FAKE_GITHUB_TOKEN);
    const [line] = logLines(capture.sink);
    expect(line.msg).toBe("list_repos failed");
    expect((line.err as Record<string, unknown>).message).toBe(
      "Bad credentials",
    );
    expect(line.route).toBe("GET /api/repos");
    expect(line.level).toBe(50);
    expect(line.time as string).toMatch(ISO_8601);
  });

  it("serializes a non-Error value safely", () => {
    logger.error({ err: "string error value" }, "Unexpected failure");

    expect(capture.sink.join("")).toContain("string error value");
  });
});

describe("buildLoggerOptions — dev pretty vs prod JSON, redaction, error allowlist", () => {
  it("uses a pino-pretty transport in development", () => {
    const options = buildLoggerOptions("development");
    expect(options.transport).toBeDefined();
    expect((options.transport as { target?: string } | undefined)?.target).toBe(
      "pino-pretty",
    );
  });

  it("emits no transport (raw JSON) outside development", () => {
    expect(buildLoggerOptions("production").transport).toBeUndefined();
    expect(buildLoggerOptions("test").transport).toBeUndefined();
  });

  it("censors credential headers case-insensitively via the headers serializer", () => {
    const headersSerializer = (
      buildLoggerOptions("production").serializers as {
        headers: (h: unknown) => Record<string, string>;
      }
    ).headers;

    const out = headersSerializer({
      Authorization: "Bearer x",
      COOKIE: "y",
      "x-reef-llm": "z",
      "content-type": "application/json",
    });

    expect(out.Authorization).toBe("[REDACTED]");
    expect(out.COOKIE).toBe("[REDACTED]");
    expect(out["x-reef-llm"]).toBe("[REDACTED]");
    expect(out["content-type"]).toBe("application/json");
  });

  it("serializes errors to a type/message/stack allowlist, dropping nested props", () => {
    const errSerializer = (
      buildLoggerOptions("production").serializers as {
        err: (e: unknown) => Record<string, unknown>;
      }
    ).err;

    const out = errSerializer(
      Object.assign(new Error("boom"), {
        request: { headers: { authorization: "secret-token" } },
      }),
    );

    expect(out).toEqual({
      type: "Error",
      message: "boom",
      stack: expect.any(String),
    });
    expect(JSON.stringify(out)).not.toContain("secret-token");
  });

  it("preserves the upstream status of a typed reef API error, not its detail (REEF-271)", async () => {
    const { AkbApiError } = await import("@reef/core");
    const errSerializer = (
      buildLoggerOptions("production").serializers as {
        err: (e: unknown) => Record<string, unknown>;
      }
    ).err;

    // The upstream `detail` text rides `context.message` and is canary-marked
    // here; only the numeric `status` (which distinguishes a 502 from a 404)
    // should reach the log — the upstream-controlled detail must not.
    const out = errSerializer(
      new AkbApiError({ status: 502, message: "AKB_DETAIL_CANARY exploded" }),
    );

    expect(out).toMatchObject({ type: "AkbApiError", status: 502 });
    expect(out).not.toHaveProperty("upstream");
    expect(JSON.stringify(out)).not.toContain("AKB_DETAIL_CANARY");
  });

  it("never logs the upstream detail of LLM or GitHub errors (bodies may carry credentials)", async () => {
    const { LlmError, GitHubApiError } = await import("@reef/core");
    const errSerializer = (
      buildLoggerOptions("production").serializers as {
        err: (e: unknown) => Record<string, unknown>;
      }
    ).err;

    // Both context messages are upstream-controlled free text (an LLM provider
    // body / an Octokit message) — neither may reach stdout.
    const llm = errSerializer(
      new LlmError({
        message: 'provider 401: {"key":"LLM_KEY_CANARY_abc invalid"}',
      }),
    );
    expect(llm.type).toBe("LlmError");
    expect(llm).not.toHaveProperty("upstream");
    expect(JSON.stringify(llm)).not.toContain("LLM_KEY_CANARY_abc");

    const gh = errSerializer(
      new GitHubApiError({ status: 500, message: "GH_BODY_CANARY enterprise" }),
    );
    expect(gh).toMatchObject({ type: "GitHubApiError", status: 500 });
    expect(gh).not.toHaveProperty("upstream");
    expect(JSON.stringify(gh)).not.toContain("GH_BODY_CANARY");
  });

  it("surfaces a numeric status but never the nested request/response credentials", () => {
    const errSerializer = (
      buildLoggerOptions("production").serializers as {
        err: (e: unknown) => Record<string, unknown>;
      }
    ).err;

    const out = errSerializer(
      Object.assign(new Error("Bad credentials"), {
        status: 401,
        request: { headers: { authorization: `token ${FAKE_GITHUB_TOKEN}` } },
        response: { data: { token: FAKE_GITHUB_TOKEN } },
      }),
    );

    expect(out.status).toBe(401);
    expect(JSON.stringify(out)).not.toContain(FAKE_GITHUB_TOKEN);
    expect(out).not.toHaveProperty("request");
    expect(out).not.toHaveProperty("response");
  });
});
