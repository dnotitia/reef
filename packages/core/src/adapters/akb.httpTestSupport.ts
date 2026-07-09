import { afterEach, beforeEach, vi } from "vitest";
import { createAkbAdapter } from "./akb";

// ── OTel passthrough (mirrors github.test.ts) ────────────────────────────────
type SpanMock = {
  setAttribute: ReturnType<typeof vi.fn>;
  addEvent: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

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

// ── fetch mocking helpers ────────────────────────────────────────────────────

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface FetchResponseSpec {
  status?: number;
  body?: unknown;
  rawBody?: BodyInit;
  headers?: HeadersInit;
  /** Set true for a body-less response (e.g. 204). */
  empty?: boolean;
}

export function setupFetch(responses: FetchResponseSpec[]): {
  calls: FetchCall[];
  fetchMock: ReturnType<typeof vi.fn>;
} {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) {
      throw new Error(`No mocked response for ${url}`);
    }
    const status = next.status ?? 200;
    if (next.rawBody !== undefined) {
      return new Response(next.rawBody, {
        status,
        headers: next.headers,
      });
    }
    if (next.empty || next.body === undefined) {
      return new Response(null, { status });
    }
    return new Response(JSON.stringify(next.body), {
      status,
      headers: { "content-type": "application/json", ...next.headers },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export function makeAdapter() {
  return createAkbAdapter({
    baseUrl: "https://akb.test",
    jwt: "jwt.example.token",
  });
}
