import type { Span } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CoreLogger,
  getCoreLogger,
  observe,
  setCoreLogger,
} from "./index";

function fakeSpan(): { span: Span; attributes: Record<string, unknown> } {
  const attributes: Record<string, unknown> = {};
  const span = {
    setAttribute: (key: string, value: unknown) => {
      attributes[key] = value;
      return span;
    },
  } as unknown as Span;
  return { span, attributes };
}

function fakeLogger(): {
  logger: CoreLogger;
  calls: Array<{ level: string; fields: Record<string, unknown>; msg: string }>;
} {
  const calls: Array<{
    level: string;
    fields: Record<string, unknown>;
    msg: string;
  }> = [];
  const make =
    (level: string) => (fields: Record<string, unknown>, msg: string) => {
      calls.push({ level, fields, msg });
    };
  return {
    logger: { info: make("info"), warn: make("warn"), debug: make("debug") },
    calls,
  };
}

afterEach(() => {
  setCoreLogger(null);
});

describe("setCoreLogger / getCoreLogger", () => {
  it("defaults to a silent no-op logger that never throws", () => {
    expect(() => getCoreLogger().info({ a: 1 }, "x")).not.toThrow();
  });

  it("wires and clears the process logger", () => {
    const { logger } = fakeLogger();
    setCoreLogger(logger);
    expect(getCoreLogger()).toBe(logger);
    setCoreLogger(null);
    expect(getCoreLogger()).not.toBe(logger);
  });
});

describe("observe — emit once, shape twice", () => {
  it("sets each defined field as a span attribute and logs them once", () => {
    const { span, attributes } = fakeSpan();
    const { logger, calls } = fakeLogger();
    setCoreLogger(logger);

    observe(span, { commits_scanned: 3, repo: "o/r" }, "scan_activity fetched");

    expect(attributes).toEqual({ commits_scanned: 3, repo: "o/r" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      level: "info",
      fields: { commits_scanned: 3, repo: "o/r" },
      msg: "scan_activity fetched",
    });
  });

  it("drops undefined fields from both the span and the log line", () => {
    const { span, attributes } = fakeSpan();
    const { logger, calls } = fakeLogger();
    setCoreLogger(logger);

    observe(span, { a: 1, b: undefined }, "msg");

    expect(attributes).toEqual({ a: 1 });
    expect(calls[0].fields).toEqual({ a: 1 });
  });

  it("honors the level option", () => {
    const { span } = fakeSpan();
    const { logger, calls } = fakeLogger();
    setCoreLogger(logger);

    observe(span, { remaining: 2 }, "github rate limit low", { level: "warn" });

    expect(calls[0].level).toBe("warn");
  });

  it("still sets span attributes when no logger is wired (prod + trace backend)", () => {
    const { span, attributes } = fakeSpan();
    setCoreLogger(null);

    expect(() => observe(span, { a: 1 }, "msg")).not.toThrow();
    expect(attributes).toEqual({ a: 1 });
  });

  it("logs without a span when one is not supplied", () => {
    const { logger, calls } = fakeLogger();
    setCoreLogger(logger);

    observe(undefined, { a: 1 }, "msg");

    expect(calls).toHaveLength(1);
    expect(calls[0].fields).toEqual({ a: 1 });
  });
});
