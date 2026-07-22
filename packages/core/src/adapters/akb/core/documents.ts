import { ZodError, z } from "zod";
import { SchemaValidationError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
import type { AkbDocumentReference } from "../../../schemas/issues/references";
import { buildIssueAkbTitle, uniqueStrings } from "../issues/issueRows";
import { ISSUES_COLLECTION } from "./constants";
import {
  type AkbAdapter,
  type AkbSearchHit,
  AkbSearchHitSchema,
  AkbSearchResponseSchema,
  type DocumentPutResponse,
  DocumentPutResponseSchema,
  type DocumentResponse,
  DocumentResponseSchema,
} from "./http";

const AKB_DOCUMENT_URI_PARTS_RE =
  /^akb:\/\/([^/]+)\/(?:(?:coll\/(.+)\/doc\/(.+))|(?:doc\/(.+)))$/;
const INTERNAL_INITIALIZATION_MARKER_URI_SUFFIX =
  "/coll/overview/doc/reef-initialization.md";

function publicSearchHits(hits: AkbSearchHit[], limit: number): AkbSearchHit[] {
  return hits
    .filter(
      (hit) => !hit.uri.endsWith(INTERNAL_INITIALIZATION_MARKER_URI_SUFFIX),
    )
    .slice(0, limit);
}

function documentPathFromUri(
  expectedVault: string,
  uri: string,
): string | null {
  const match = AKB_DOCUMENT_URI_PARTS_RE.exec(uri);
  if (!match || match[1] !== expectedVault) return null;
  const collection = match[2];
  const collSlug = match[3];
  const rootPath = match[4];
  return collection && collSlug ? `${collection}/${collSlug}` : rootPath;
}

export async function searchDocuments({
  adapter,
  vault,
  collection,
  type,
  query,
  limit,
}: {
  adapter: AkbAdapter;
  vault: string;
  collection?: string;
  type?: string;
  query: string;
  limit: number;
}): Promise<AkbSearchHit[]> {
  const payload = await adapter.request("/api/v1/search", {
    query: {
      vault,
      collection,
      type,
      // akb's search endpoint takes the search term as `q` (a REQUIRED query
      // param — see OpenAPI GET /api/v1/search). Sending it as `query` omits
      // `q` and 422s, so semantic search does not reach akb. Caught by the
      // REEF-050 contract review.
      q: query,
      // The internal lifecycle marker can occupy a ranked result slot. Fetch
      // one spare result, filter the marker, then restore the caller's limit.
      limit: limit + 1,
    },
  });
  if (Array.isArray(payload)) {
    return publicSearchHits(z.array(AkbSearchHitSchema).parse(payload), limit);
  }
  const parsed = AkbSearchResponseSchema.parse(payload);
  return publicSearchHits(parsed.results ?? parsed.items ?? [], limit);
}

/**
 * Resolve document titles for markdown `akb://` links. Failures stay local to
 * each URI so editing does not block when a pasted document is missing or the
 * title lookup is temporarily unavailable.
 */
export async function resolveDocumentTitles({
  adapter,
  vault,
  uris,
}: {
  adapter: AkbAdapter;
  vault: string;
  uris: readonly string[];
}): Promise<AkbDocumentReference[]> {
  const uniqueUris = [...new Set(uris)];
  const documents = await Promise.all(
    uniqueUris.map(async (uri): Promise<AkbDocumentReference> => {
      const path = documentPathFromUri(vault, uri);
      if (!path) return { uri, title: null, resource_type: "doc" };
      try {
        const payload = await adapter.request(
          `/api/v1/documents/${encodeURIComponent(vault)}/${path}`,
          { resource: `document ${path}` },
        );
        const document = ensureDocumentResponse(payload);
        return { uri, title: document.title, resource_type: "doc" };
      } catch {
        return { uri, title: null, resource_type: "doc" };
      }
    }),
  );
  return documents;
}

/**
 * Best-effort document delete used to compensate a failed row INSERT in
 * `writeIssue` — we'd rather surface the original error than mask it with a
 * cleanup failure, so this swallows its own errors.
 */
export async function deleteDocumentQuietly(
  adapter: AkbAdapter,
  vault: string,
  path: string,
): Promise<void> {
  try {
    await adapter.request(
      `/api/v1/documents/${encodeURIComponent(vault)}/${path}`,
      { method: "DELETE" },
    );
  } catch {
    // swallow — compensation is best-effort
  }
}

/**
 * Delete a document by its akb-relative path via
 * `DELETE /api/v1/documents/{vault}/{path}` (writer role). Unlike
 * `deleteDocumentQuietly`, errors propagate so a teardown caller can react.
 * The `path` is forwarded verbatim — it carries slashes (e.g.
 * `overview/vault-skill.md`) that akb's `{doc_id:path}` route segment preserves.
 */
export async function deleteDocument(
  adapter: AkbAdapter,
  vault: string,
  path: string,
): Promise<void> {
  await adapter.request(
    `/api/v1/documents/${encodeURIComponent(vault)}/${path}`,
    { method: "DELETE", resource: `document ${path}` },
  );
}

/**
 * Delete a collection and, when `recursive`, every document, file, and
 * sub-collection beneath it via `DELETE /api/v1/collections/{vault}/{path}`
 * (writer role). akb returns 409 for a non-empty collection unless `recursive`
 * is set, so reef passes `recursive: true` when sweeping its own collections.
 * The `path` keeps its slashes (akb's `{path:path}` route segment preserves
 * them).
 */
export async function deleteCollection(
  adapter: AkbAdapter,
  vault: string,
  path: string,
  recursive = true,
): Promise<void> {
  await adapter.request(
    `/api/v1/collections/${encodeURIComponent(vault)}/${path}`,
    {
      method: "DELETE",
      query: { recursive: recursive ? "true" : undefined },
      resource: `collection ${path}`,
    },
  );
}

/** An issue's akb document body is plain markdown — reef fields live in the
 * `reef_issues` row, not a fenced head (unlike templates). */
export function buildPutRequestBody(
  vault: string,
  issue: IssueMetadata,
  body: string,
): Record<string, unknown> {
  return {
    vault,
    collection: ISSUES_COLLECTION,
    title: buildIssueAkbTitle(issue),
    content: body,
    type: "task",
    // reef does not reads the akb document lifecycle status — an issue's own status
    // lives in the `reef_issues` row, and `readIssue` ignores the document's
    // status field. The akb default of `draft` is therefore pure noise that
    // leaks into MCP grounding (`akb_get` / `akb_browse`), making agents reason
    // about a non-existent "draft" state and waste tokens. Publish issues as
    // `active` explicitly rather than relying on the backend default, so the
    // behaviour holds across akb instances/versions. `active` is descriptive
    // metadata just — it does not gate search, browse, or access.
    status: "active",
    summary: issue.title,
    tags: issue.labels ?? [],
    depends_on: issue.depends_on ?? [],
    related_to: uniqueStrings([
      ...(issue.blocks ?? []),
      ...(issue.related_to ?? []),
    ]),
  };
}

/**
 * The PATCH body that projects an issue's akb-native fields onto its document
 * (title→title, summary, labels→tags, depends_on/blocks→relations). Shared by
 * `updateIssue`'s forward edit and its compensating re-PATCH, so a partial
 * failure can rewind the document to its prior values byte-for-byte. The caller
 * adds an optional `message` (commit message) on top.
 */
export function buildIssueDocPatchBody(
  issue: IssueMetadata,
  content: string,
): Record<string, unknown> {
  return {
    title: buildIssueAkbTitle(issue),
    content,
    summary: issue.title,
    tags: issue.labels ?? [],
    depends_on: issue.depends_on ?? [],
    related_to: uniqueStrings([
      ...(issue.blocks ?? []),
      ...(issue.related_to ?? []),
    ]),
  };
}

export function ensureDocumentResponse(payload: unknown): DocumentResponse {
  try {
    return DocumentResponseSchema.parse(payload);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["akb document response validation failed"],
    });
  }
}

export function ensureDocumentPutResponse(
  payload: unknown,
): DocumentPutResponse {
  try {
    return DocumentPutResponseSchema.parse(payload);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new SchemaValidationError({
        issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    throw new SchemaValidationError({
      issues: ["akb put response validation failed"],
    });
  }
}
