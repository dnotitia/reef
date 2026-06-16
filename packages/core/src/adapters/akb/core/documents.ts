import { ZodError, z } from "zod";
import { SchemaValidationError } from "../../../errors";
import type { IssueMetadata } from "../../../schemas/issues/metadata";
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
      limit,
    },
  });
  if (Array.isArray(payload)) {
    return z.array(AkbSearchHitSchema).parse(payload);
  }
  const parsed = AkbSearchResponseSchema.parse(payload);
  return parsed.results ?? parsed.items ?? [];
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
