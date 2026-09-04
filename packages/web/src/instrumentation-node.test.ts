// @vitest-environment node

import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => {
  const exporter = { kind: "otlp-exporter" };
  const batchSpanProcessor = { kind: "batch-span-processor" };
  const requestLogSpanProcessor = { kind: "request-log-span-processor" };
  const pinoInstrumentation = { kind: "pino-instrumentation" };
  const openTelemetry = { kind: "ai-sdk-open-telemetry" };
  const resource = { kind: "resource" };
  const sdk = {
    start: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };

  return {
    exporter,
    batchSpanProcessor,
    requestLogSpanProcessor,
    pinoInstrumentation,
    openTelemetry,
    resource,
    sdk,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    // biome-ignore lint/complexity/useArrowFunction: this mock is instantiated with new.
    NodeSDK: vi.fn(function () {
      return sdk;
    }),
    // biome-ignore lint/complexity/useArrowFunction: this mock is instantiated with new.
    OTLPTraceExporter: vi.fn(function () {
      return exporter;
    }),
    // biome-ignore lint/complexity/useArrowFunction: this mock is instantiated with new.
    BatchSpanProcessor: vi.fn(function () {
      return batchSpanProcessor;
    }),
    // biome-ignore lint/complexity/useArrowFunction: this mock is instantiated with new.
    RequestLogSpanProcessor: vi.fn(function () {
      return requestLogSpanProcessor;
    }),
    // biome-ignore lint/complexity/useArrowFunction: this mock is instantiated with new.
    PinoInstrumentation: vi.fn(function () {
      return pinoInstrumentation;
    }),
    resourceFromAttributes: vi.fn(() => resource),
    responseLoggingEnabled: vi.fn<() => boolean>(),
    setCoreLogger: vi.fn(),
    // biome-ignore lint/complexity/useArrowFunction: this mock is instantiated with new.
    OpenTelemetry: vi.fn(function () {
      return openTelemetry;
    }),
    registerTelemetry: vi.fn(),
  };
});

vi.mock("@/lib/logging/requestSpanLog", () => ({
  RequestLogSpanProcessor: mocks.RequestLogSpanProcessor,
  responseLoggingEnabled: mocks.responseLoggingEnabled,
}));
vi.mock("@/lib/logging/logger", () => ({ logger: mocks.logger }));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: mocks.OTLPTraceExporter,
}));
vi.mock("@opentelemetry/instrumentation-pino", () => ({
  PinoInstrumentation: mocks.PinoInstrumentation,
}));
vi.mock("@opentelemetry/resources", () => ({
  resourceFromAttributes: mocks.resourceFromAttributes,
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: mocks.NodeSDK,
  tracing: { BatchSpanProcessor: mocks.BatchSpanProcessor },
}));
vi.mock("@reef/core", () => ({ setCoreLogger: mocks.setCoreLogger }));
vi.mock("@ai-sdk/otel", () => ({ OpenTelemetry: mocks.OpenTelemetry }));
vi.mock("ai", () => ({ registerTelemetry: mocks.registerTelemetry }));

import { registerNode } from "./instrumentation-node";

describe("registerNode", () => {
  let processOnceSpy: MockInstance<typeof process.once>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.responseLoggingEnabled.mockReturnValue(false);
    processOnceSpy = vi.spyOn(process, "once");
  });

  afterEach(() => {
    for (const [event, listener] of processOnceSpy.mock.calls) {
      if (event === "SIGTERM" || event === "SIGINT") {
        process.removeListener(event, listener as (...args: unknown[]) => void);
      }
    }
    processOnceSpy.mockRestore();
  });

  it("configures the exporter, resource, processors, and shutdown signals", () => {
    registerNode();

    expect(mocks.OTLPTraceExporter).toHaveBeenCalledWith();
    expect(mocks.BatchSpanProcessor).toHaveBeenCalledWith(mocks.exporter);
    expect(mocks.PinoInstrumentation).toHaveBeenCalledWith({
      disableLogSending: true,
    });
    expect(mocks.resourceFromAttributes).toHaveBeenCalledWith({
      "service.name": "reef-web",
      "service.version": "0.14.1",
    });
    expect(mocks.NodeSDK).toHaveBeenCalledWith({
      resource: mocks.resource,
      spanProcessors: [mocks.batchSpanProcessor],
      instrumentations: [mocks.pinoInstrumentation],
    });
    expect(mocks.sdk.start).toHaveBeenCalledOnce();
    expect(mocks.OpenTelemetry).toHaveBeenCalledOnce();
    expect(mocks.registerTelemetry).toHaveBeenCalledOnce();
    expect(mocks.registerTelemetry).toHaveBeenCalledWith(mocks.openTelemetry);
    expect(processOnceSpy).toHaveBeenNthCalledWith(
      1,
      "SIGTERM",
      expect.any(Function),
    );
    expect(processOnceSpy).toHaveBeenNthCalledWith(
      2,
      "SIGINT",
      expect.any(Function),
    );
    const sigtermHandler = processOnceSpy.mock.calls.find(
      ([event]) => event === "SIGTERM",
    )?.[1];
    expect(sigtermHandler).toEqual(expect.any(Function));
    (sigtermHandler as () => void)();
    expect(mocks.sdk.shutdown).toHaveBeenCalledOnce();
  });

  it("adds response logging and wires the core logger when enabled", async () => {
    mocks.responseLoggingEnabled.mockReturnValue(true);

    registerNode();

    expect(mocks.RequestLogSpanProcessor).toHaveBeenCalledOnce();
    expect(mocks.NodeSDK).toHaveBeenCalledWith({
      resource: mocks.resource,
      spanProcessors: [mocks.batchSpanProcessor, mocks.requestLogSpanProcessor],
      instrumentations: [mocks.pinoInstrumentation],
    });
    await vi.waitFor(() => {
      expect(mocks.setCoreLogger).toHaveBeenCalledWith({
        info: expect.any(Function),
        warn: expect.any(Function),
        debug: expect.any(Function),
      });
    });
  });
});
