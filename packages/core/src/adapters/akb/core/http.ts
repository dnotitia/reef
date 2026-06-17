import { z } from "zod";
import {
  AkbApiError,
  AuthError,
  ConflictError,
  NotFoundError,
  SchemaValidationError,
} from "../../../errors";
import { stripTrailingSlashes } from "../../url";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AkbAdapter {
  request: AkbRequest;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface AkbRequestInit {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Resource label used to translate 404 responses into NotFoundError. */
  resource?: string;
}

export type AkbRequest = (
  path: string,
  init?: AkbRequestInit,
) => Promise<unknown>;

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

async function extractErrorMessage(response: Response): Promise<string> {
  // FastAPI default surfaces `detail`; akb's main.py wraps as `error`.
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return response.statusText || "Unknown error";
  }
  const detail = body?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === "object") {
    const msg = (detail[0] as { msg?: unknown }).msg;
    if (typeof msg === "string") return msg;
  }
  if (typeof body?.error === "string") return body.error;
  return response.statusText || "Unknown error";
}

function translateAkbHttpError(
  status: number,
  message: string,
  resource: string | undefined,
): never {
  if (status === 401 || status === 403) {
    throw new AuthError({ message });
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
  throw new AkbApiError({ status, message });
}

function makeRequest(baseUrl: string, jwt: string): AkbRequest {
  return async (path, init = {}) => {
    const url = buildUrl(baseUrl, path, init.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    };
    let body: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: init.method ?? "GET",
        headers,
        body,
      });
    } catch (err) {
      throw new AkbApiError({
        status: 0,
        message: err instanceof Error ? err.message : "Network error",
      });
    }
    if (response.status === 204) {
      return null;
    }
    if (!response.ok) {
      const message = await extractErrorMessage(response);
      translateAkbHttpError(response.status, message, init.resource);
    }
    try {
      return await response.json();
    } catch {
      // 2xx with empty body — treat as null payload.
      return null;
    }
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
