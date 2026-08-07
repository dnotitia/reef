import { vi } from "vitest";

export type SpanMock = {
  setAttribute: ReturnType<typeof vi.fn>;
  addEvent: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

export function mockOpenTelemetry(): void {
  vi.mock("@opentelemetry/api", () => ({
    SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
    trace: {
      getTracer: () => ({
        startActiveSpan: vi.fn(
          async (
            _name: string,
            fn: (span: SpanMock) => Promise<unknown>,
          ): Promise<unknown> => {
            const span: SpanMock = {
              setAttribute: vi.fn(),
              addEvent: vi.fn(),
              recordException: vi.fn(),
              setStatus: vi.fn(),
              end: vi.fn(),
            };
            return fn(span);
          },
        ),
      }),
    },
  }));
}
