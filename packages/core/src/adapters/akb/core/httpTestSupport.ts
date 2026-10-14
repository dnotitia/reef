import { vi } from "vitest";
import { createAkbAdapter } from "./http";

// ── fetch mocking helpers ────────────────────────────────────────────────────

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface SqlRequestBody {
  sql: string;
  params?: unknown[];
}

export function sqlRequestBody(call: FetchCall | undefined): SqlRequestBody {
  if (!call) throw new Error("expected an SQL request");
  return JSON.parse(String(call.init?.body)) as SqlRequestBody;
}

export interface FetchResponseSpec {
  status?: number;
  body?: unknown;
  error?: unknown;
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
    if (next.error !== undefined) throw next.error;
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
    credential: "jwt.example.token",
  });
}
