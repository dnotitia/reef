import { vi } from "vitest";

type RouteSpanMock = {
  setAttribute: () => void;
  recordException: () => void;
  setStatus: () => void;
  end: () => void;
};

export function mockRouteTelemetry(): void {
  vi.mock("@/lib/telemetry", () => ({
    tracer: {
      startActiveSpan: vi.fn(
        async (_name: string, fn: (span: RouteSpanMock) => Promise<unknown>) =>
          fn({
            setAttribute: () => {},
            recordException: () => {},
            setStatus: () => {},
            end: () => {},
          }),
      ),
    },
  }));
}

export function mockRouteLogger(): void {
  vi.mock("@/lib/logging/logger", () => ({
    logger: { error: vi.fn() },
  }));
}
