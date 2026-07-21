import { SpanStatusCode, trace } from "@opentelemetry/api";
import { z } from "zod";
import {
  AkbApiError,
  AuthError,
  ConflictError,
  NotFoundError,
  SchemaValidationError,
  isAkbAccountErrorCode,
} from "../../../errors";
import { stripTrailingSlashes } from "../../url";
import { readAkbErrorResponse } from "./errorResponse";

const tracer = trace.getTracer("@reef/core");

/** Codes whose exact value is required for service-side control flow. */
export function sanitizeCredentialSafeAkbCode(
  code: string | undefined,
): string | undefined {
  return code === "undefined_table" ? code : undefined;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AkbFetchBody = Exclude<
  NonNullable<Parameters<typeof fetch>[1]>["body"],
  null
>;

export interface AkbAdapter {
  request: AkbRequest;
  /** Upstream-controlled error text must not escape this adapter boundary. */
  credentialSafeErrors?: boolean;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface AkbRequestInit {
  method?: HttpMethod;
  body?: unknown;
  rawBody?: AkbFetchBody;
  rawHeaders?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  /** Resource label used to translate 404 responses into NotFoundError. */
  resource?: string;
  responseType?: "json" | "arrayBuffer";
}

export type AkbRequest = (
  path: string,
  init?: AkbRequestInit,
) => Promise<unknown>;

export interface AkbBinaryResponse {
  body: ArrayBuffer;
  contentType: string | null;
  contentLength: number | null;
  filename: string | null;
}

// ─── Response envelopes (validated at the boundary) ───────────────────────────

export const DocumentPutResponseSchema = z.object({
  uri: z.string().min(1),
  vault: z.string().min(1),
  path: z.string().min(1),
  commit_hash: z.string(),
  chunks_indexed: z.number().int().nonnegative().optional(),
  entities_found: z.number().int().nonnegative().optional(),
});

export type DocumentPutResponse = z.infer<typeof DocumentPutResponseSchema>;

export const DocumentResponseSchema = z.object({
  uri: z.string().min(1),
  vault: z.string().min(1),
  path: z.string().min(1),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  summary: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  current_commit: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  content: z.string().nullable().optional(),
  is_public: z.boolean().optional(),
  public_slug: z.string().nullable().optional(),
});

export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;

// akb's `GET /api/v1/search` serializes each hit's document type under the
// `doc_type` key (see akb `SearchResult`), NOT `type`. The document-reference
// picker (REEF-083) reads `doc_type` to render a type glyph, so it is now a
// named field rather than a passthrough mirror. `.passthrough()` still
// preserves any other akb field verbatim.
export const AkbSearchHitSchema = z
  .object({
    uri: z.string().min(1),
    // nullable: a document with no title comes back as `title: null`. The
    // document-reference picker + search_documents tool read this field, so
    // rejecting null would fail the whole search over a single untitled hit.
    title: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    score: z.number().nullable().optional(),
    matched_section: z.string().nullable().optional(),
    source_type: z.string().optional(),
    vault: z.string().optional(),
    collection: z.string().nullable().optional(),
    doc_type: z.string().nullable().optional(),
    tags: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export type AkbSearchHit = z.infer<typeof AkbSearchHitSchema>;

export const AkbSearchResponseSchema = z
  .object({
    results: z.array(AkbSearchHitSchema).optional(),
    items: z.array(AkbSearchHitSchema).optional(),
  })
  .passthrough();

// ─── request helper ──────────────────────────────────────────────────────────

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const trimmedBase = stripTrailingSlashes(baseUrl);
  const trimmedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${trimmedBase}${trimmedPath}`;
  if (!query) {
    return url;
  }
  const entries = Object.entries(query).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) {
    return url;
  }
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.append(key, String(value));
  }
  return `${url}?${params.toString()}`;
}

function translateAkbHttpError(
  status: number,
  message: string,
  code: string | undefined,
  resource: string | undefined,
): never {
  if (isAkbAccountErrorCode(code)) {
    throw new AuthError({ origin: "akb", code, status, message });
  }
  if (status === 401 || status === 403) {
    throw new AuthError({ origin: "akb", code, status, message });
  }
  if (status === 404) {
    throw new NotFoundError({ resource });
  }
  if (status === 409) {
    throw new ConflictError({ path: resource });
  }
  if (status === 422) {
    throw new SchemaValidationError({ issues: [message] });
  }
  throw new AkbApiError({ status, message, code });
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain?.[1] ?? null;
}

function makeRequest(
  baseUrl: string,
  jwt: string,
  { credentialSafeErrors = false }: { credentialSafeErrors?: boolean } = {},
): AkbRequest {
  return async (path, init = {}) => {
    const url = buildUrl(baseUrl, path, init.query);
    const method = init.method ?? "GET";
    // Wrap the raw akb fetch in its own span so the upstream HTTP status and
    // duration are first-class trace data (REEF-271). The per-operation `akb.*`
    // work-unit spans record vault/resource but not the HTTP status — on an
    // upstream error they surface the translated ReefError, so a slow or
    // failing akb backend was invisible at the HTTP level. The Bearer token is a
    // header and does not reach the URL, so the recorded path carries no secret.
    return tracer.startActiveSpan("akb.http.request", async (span) => {
      span.setAttribute("http.method", method);
      span.setAttribute("akb.http.path", path);
      const startMs = Date.now();
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/json",
          ...init.rawHeaders,
        };
        let body: AkbFetchBody | undefined;
        if (init.body !== undefined) {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(init.body);
        } else if (init.rawBody !== undefined) {
          body = init.rawBody;
        }
        let response: Response;
        try {
          response = await fetch(url, { method, headers, body });
        } catch (err) {
          const error = credentialSafeErrors
            ? new Error("akb_network_error")
            : err instanceof Error
              ? err
              : new Error("Network error");
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
          throw new AkbApiError({ status: 0, message: error.message });
        }
        span.setAttribute("http.status_code", response.status);
        // A 5xx (or the network failure above) marks the span errored;
        // a 4xx such as an expected 404 keeps the status_code attribute without
        // flagging the span, so not-found probes stay clean in the trace.
        if (response.status >= 500) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `akb upstream ${response.status}`,
          });
        }
        if (response.status === 204) {
          return null;
        }
        if (!response.ok) {
          const error = await readAkbErrorResponse(response);
          translateAkbHttpError(
            response.status,
            credentialSafeErrors
              ? `akb_upstream_error_${response.status}`
              : error.message,
            credentialSafeErrors
              ? sanitizeCredentialSafeAkbCode(error.code)
              : error.code,
            init.resource,
          );
        }
        if (init.responseType === "arrayBuffer") {
          return {
            body: await response.arrayBuffer(),
            contentType: response.headers.get("content-type"),
            contentLength:
              response.headers.get("content-length") != null
                ? Number(response.headers.get("content-length"))
                : null,
            filename: filenameFromContentDisposition(
              response.headers.get("content-disposition"),
            ),
          } satisfies AkbBinaryResponse;
        }
        try {
          return await response.json();
        } catch {
          // 2xx with empty body — treat as null payload.
          return null;
        }
      } finally {
        span.setAttribute("akb.http.duration_ms", Date.now() - startMs);
        span.end();
      }
    });
  };
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Factory: create a per-request adapter scoped to a single user's JWT.
 *
 * Callers should instantiate the adapter inside the request handler and let it be
 * GC'd on return — does not cache at module scope. The JWT is held in the closure
 * for the lifetime of the request.
 */
export function createAkbAdapter({
  baseUrl,
  jwt,
}: {
  baseUrl: string;
  jwt: string;
}): AkbAdapter {
  return { request: makeRequest(baseUrl, jwt) };
}

/**
 * Create an adapter for short-lived deployment automation.
 *
 * Unlike the user-session adapter, upstream-controlled error text is replaced
 * with a bounded status code before it can reach a throwable or span. Service
 * keys can appear in proxy error bodies, so migration callers must use this
 * boundary instead of attempting output redaction after the fact.
 */
export function createAkbServiceAdapter({
  baseUrl,
  serviceKey,
}: {
  baseUrl: string;
  serviceKey: string;
}): AkbAdapter {
  return {
    request: makeRequest(baseUrl, serviceKey, { credentialSafeErrors: true }),
    credentialSafeErrors: true,
  };
}
