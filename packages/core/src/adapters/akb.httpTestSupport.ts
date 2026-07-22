import { afterEach, beforeEach, vi } from "vitest";
import {
  REEF_SCHEMA_VERSION,
  REEF_SETTINGS_SCHEMA_VERSION_KEY,
  createAkbAdapter,
} from "./akb";

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
    const requestBody =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as { sql?: unknown })
        : null;
    const isSchemaVersionRead =
      typeof requestBody?.sql === "string" &&
      requestBody.sql.startsWith("SELECT ") &&
      requestBody.sql.includes(`'${REEF_SETTINGS_SCHEMA_VERSION_KEY}'`);
    const queuedBody = queue[0]?.body as
      | { kind?: unknown; columns?: unknown }
      | undefined;
    const hasExplicitVersionResponse =
      queuedBody?.kind === "table_query" &&
      Array.isArray(queuedBody.columns) &&
      queuedBody.columns.includes("value");
    if (isSchemaVersionRead && !hasExplicitVersionResponse) {
      return new Response(
        JSON.stringify({
          kind: "table_query",
          vaults: ["reef-sample"],
          columns: ["value"],
          items: [
            {
              value: JSON.stringify({
                version: REEF_SCHEMA_VERSION,
                applied_at: "2026-07-22T00:00:00.000Z",
              }),
            },
          ],
          total: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
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
