import { vi } from "vitest";

/**
 * Shape of the OpenTelemetry span passthrough used by tool tests.
 *
 * Exposes every method the tool implementations touch (`setAttribute`,
 * `addEvent`, `recordException`, `setStatus`, `end`) so individual tests can
 * assert against the captured spy if they care, but the default install does
 * not bind any expectations — every method is a fresh no-op spy.
 */
export type SpanMock = {
  setAttribute: ReturnType<typeof vi.fn>;
  addEvent: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

/**
 * Install a hoisted `@opentelemetry/api` mock that turns `withSpan` /
 * `withToolSpan` into a pass-through. should be called at module scope (before
 * the tool import) — `vi.mock` is hoisted by Vitest, so calling it from a
 * helper function just works because the call itself is what gets hoisted,
 * not the surrounding helper invocation.
 *
 * Replaces the ~22-line block previously duplicated across each core tool
 * test (`listAssignees`, `readIssue`, `searchIssues`, `updateIssue`).
 */
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
