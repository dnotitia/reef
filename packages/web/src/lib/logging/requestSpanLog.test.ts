// @vitest-environment node

import type { tracing } from "@opentelemetry/sdk-node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RequestLogSpanProcessor,
  requestCompletionFromSpan,
  responseLoggingEnabled,
  slowRequestThresholdMs,
} from "./requestSpanLog";

/**
 * Tests for the response-phase request log derived from Next.js request spans.
 *
 * Next.js emits two `BaseServer.handleRequest` spans per request; the
 * matched-route span carries `http.route`, so the mapper keys on that to scope
 * to `/api/*` and dedupe to one line per request.
 */

function fakeSpan(opts: {
  spanType?: unknown;
  route?: string;
  method?: string;
  status?: number;
  duration?: [number, number];
  traceId?: string;
  name?: string;
}): tracing.ReadableSpan {
  const attributes: Record<string, unknown> = {
    "next.span_type": opts.spanType ?? "BaseServer.handleRequest",
  };
  if (opts.route !== undefined) attributes["http.route"] = opts.route;
  if (opts.method !== undefined) attributes["http.method"] = opts.method;
  if (opts.status !== undefined) attributes["http.status_code"] = opts.status;
  return {
    name: opts.name ?? "GET /api/test",
    duration: opts.duration ?? [0, 0],
    attributes,
    spanContext: () => ({
      traceId: opts.traceId ?? "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
    }),
  } as unknown as tracing.ReadableSpan;
}

describe("requestCompletionFromSpan", () => {
  it("projects a matched /api route span to a completion record", () => {
    const record = requestCompletionFromSpan(
      fakeSpan({
        route: "/api/planning",
        method: "GET",
        status: 401,
        duration: [0, 92_800_000],
        traceId: "trace-xyz",
      }),
    );

    expect(record).toEqual({
      method: "GET",
      route: "/api/planning",
      status: 401,
      duration_ms: 92.8,
      trace_id: "trace-xyz",
    });
  });

  it("converts HrTime ([s, ns]) to milliseconds rounded to 0.1ms", () => {
    expect(
      requestCompletionFromSpan(
        fakeSpan({ route: "/api/x", duration: [1, 500_000_000] }),
      )?.duration_ms,
    ).toBe(1500);
    expect(
      requestCompletionFromSpan(
        fakeSpan({ route: "/api/x", duration: [0, 41_812_345] }),
      )?.duration_ms,
    ).toBe(41.8);
  });

  it("returns null for the outer proxy span (no http.route — dedupe)", () => {
    expect(
      requestCompletionFromSpan(
        fakeSpan({ method: "GET", status: 200, name: "GET" }),
      ),
    ).toBeNull();
  });

  it("returns null for non-request spans", () => {
    expect(
      requestCompletionFromSpan(
        fakeSpan({ spanType: "AppRender.fetch", route: "/api/x" }),
      ),
    ).toBeNull();
  });

  it("returns null for non-/api matched routes (page navigations)", () => {
    expect(
      requestCompletionFromSpan(fakeSpan({ route: "/board", method: "GET" })),
    ).toBeNull();
  });

  it("defaults a missing/non-numeric status to 0 and a missing method to empty", () => {
    const record = requestCompletionFromSpan(fakeSpan({ route: "/api/x" }));
    expect(record?.status).toBe(0);
    expect(record?.method).toBe("");
  });
});

describe("responseLoggingEnabled — dev/deploy split", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on in development", () => {
    expect(responseLoggingEnabled("development")).toBe(true);
  });

  it("is off in production and test by default", () => {
    expect(responseLoggingEnabled("production")).toBe(false);
    expect(responseLoggingEnabled("test")).toBe(false);
    expect(responseLoggingEnabled(undefined)).toBe(false);
  });

  it("can be force-enabled in any environment via REEF_RESPONSE_LOG=1", () => {
    vi.stubEnv("REEF_RESPONSE_LOG", "1");
    expect(responseLoggingEnabled("production")).toBe(true);
  });
});

describe("RequestLogSpanProcessor", () => {
  let sink: string[];
  let restore: () => void;

  beforeEach(() => {
    sink = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((
      chunk: unknown,
    ) => {
      sink.push(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof process.stdout.write);
    restore = () => spy.mockRestore();
  });

  afterEach(() => {
    restore();
  });

  function responseLine(): Record<string, unknown> | undefined {
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
      .find((o): o is Record<string, unknown> => o?.msg === "response");
  }

  it("emits one structured 'response' log for a matched /api span", async () => {
    // `logResponse` is the awaitable form of `onEnd` (the logger is imported
    // lazily, so the write completes a microtask later).
    await new RequestLogSpanProcessor().logResponse(
      fakeSpan({
        route: "/api/issues",
        method: "POST",
        status: 201,
        duration: [0, 12_000_000],
      }),
    );

    const line = responseLine();
    expect(line).toBeTruthy();
    expect(line?.method).toBe("POST");
    expect(line?.route).toBe("/api/issues");
    expect(line?.status).toBe(201);
    expect(line?.duration_ms).toBe(12);
    expect(line?.level).toBe(30);
  });

  it("emits nothing for spans that are not matched /api request spans", async () => {
    const processor = new RequestLogSpanProcessor();
    await processor.logResponse(
      fakeSpan({ method: "GET", status: 200, name: "GET" }), // outer proxy span
    );
    await processor.logResponse(fakeSpan({ route: "/board" })); // page navigation

    expect(responseLine()).toBeUndefined();
  });

  it("promotes a slow request to WARN (REEF-271)", async () => {
    // 2s ≥ the 1000ms default threshold → level 40 (warn), not 30 (info).
    await new RequestLogSpanProcessor().logResponse(
      fakeSpan({
        route: "/api/activity/scan",
        method: "POST",
        status: 200,
        duration: [2, 0],
      }),
    );

    const line = responseLine();
    expect(line?.duration_ms).toBe(2000);
    expect(line?.level).toBe(40);
  });
});

describe("slowRequestThresholdMs — env-tunable slow-request promotion", () => {
  it("defaults to 1000ms when unset", () => {
    expect(slowRequestThresholdMs(undefined)).toBe(1000);
  });

  it("reads a positive numeric REEF_SLOW_REQUEST_MS", () => {
    expect(slowRequestThresholdMs("250")).toBe(250);
  });

  it("falls back to the default for non-positive or non-numeric values", () => {
    expect(slowRequestThresholdMs("0")).toBe(1000);
    expect(slowRequestThresholdMs("-5")).toBe(1000);
    expect(slowRequestThresholdMs("fast")).toBe(1000);
    expect(slowRequestThresholdMs("")).toBe(1000);
  });
});
