import { describe, expect, it } from "vitest";
import {
  type AkbAdapter,
  AkbSearchHitSchema,
  AkbSearchResponseSchema,
  AkbSqlMutationResponseSchema,
  AkbSqlQueryResponseSchema,
  AkbSqlResponseSchema,
  DocumentPutResponseSchema,
  DocumentResponseSchema,
  searchDocuments,
} from "../core/shared";

/**
 * Contract regression for REEF-050. reef hand-mirrors akb's HTTP response
 * envelopes as the Zod schemas above; this suite pins those mirrors against
 * akb's ACTUAL wire shape so a contract drift (akb renames/adds a key) fails in
 * CI rather than in production — the failure mode that produced REEF-049.
 *
 * This file covers the five envelopes that live in the akb adapter.
 *
 * Fixture provenance — captured 2026-06-04 against the akb backend HTTP API
 * (akb 0.1.0, OpenAPI 3.1) at localhost:8000, vault `reef`, JWT-authenticated:
 *   - DOC_GET_CAPTURE / SQL_QUERY_CAPTURE / SQL_MUTATION_CAPTURE /
 *     SEARCH_ENVELOPE_CAPTURE are verbatim live responses.
 *   - DOC_GET_CAPTURE refreshed 2026-06-19: akb 0.1.0 grew a `created_by_name`
 *     field within the same version string, caught by REEF-056's live contract
 *     smoke (`core/__tests__/integration/akb-live.contract.test.ts`).
 *   - DOC_PUT_FROM_SOURCE and SEARCH_HIT_FROM_SOURCE are NOT live: POST/PATCH
 *     mutate state, and search returned 0 hits for the test vault, so these two
 *     are synthesized from akb's serialization source (backend/app/models/
 *     document.py — `DocumentPutResponse` and `SearchResult`). Marked inline.
 *
 * Two axes per envelope:
 *   (1) HARD CONTRACT — parse the capture; a missing/renamed REQUIRED key throws
 *       (REEF-049 class). reef's mirrors are NOT `.strict()`.
 *   (2) SILENT LOSS — because the mirrors are Zod's default STRIP mode (not
 *       `.strict()`), akb keys reef does not name are dropped on parse without
 *       error. We pin that dropped-key set so akb ADDING a field breaks this
 *       test and forces a conscious mirror update.
 */

/** akb keys absent from the mirror's declared shape — the silently stripped set. */
function strippedKeys(
  capture: Record<string, unknown>,
  known: Iterable<string>,
): string[] {
  const declared = new Set(known);
  return Object.keys(capture)
    .filter((key) => !declared.has(key))
    .sort();
}

describe("DocumentResponseSchema contract", () => {
  // Live: GET /api/v1/documents/reef/issues/reef-001.md
  const DOC_GET_CAPTURE = {
    uri: "akb://reef/coll/issues/doc/reef-001.md",
    vault: "reef",
    path: "issues/reef-001.md",
    title: "REEF-001",
    type: "task",
    status: "draft",
    summary: "Testing",
    domain: null,
    created_by: "jylkim",
    created_by_name: null,
    created_at: "2026-05-20T05:25:00.025473Z",
    updated_at: "2026-05-20T05:25:00.025473Z",
    current_commit: "76c72531a7709aff0453696de3d34f11736c8079",
    content_hash:
      "e806a291cfc3e61f83b98d344ee57e3e8933cccece4fb45e1481f1f560e70eb1",
    hash_algorithm: "sha256",
    tags: ["feat"],
    content: "Testing",
    is_public: false,
    public_slug: null,
    metadata_is_current: false,
  };

  it("parses the live document-get response", () => {
    const parsed = DocumentResponseSchema.parse(DOC_GET_CAPTURE);
    expect(parsed.uri).toBe(DOC_GET_CAPTURE.uri);
    expect(parsed.path).toBe("issues/reef-001.md");
    expect(parsed.tags).toEqual(["feat"]);
  });

  it("silently strips akb keys reef does not mirror (content_hash, created_by_name, hash_algorithm, metadata_is_current)", () => {
    // akb sends these on every document GET — even without a `version` param.
    expect(DOC_GET_CAPTURE).toHaveProperty("content_hash");
    expect(DOC_GET_CAPTURE).toHaveProperty("metadata_is_current");
    const parsed = DocumentResponseSchema.parse(DOC_GET_CAPTURE) as Record<
      string,
      unknown
    >;
    // strip mode drops them — no error, but the data is gone.
    expect(parsed).not.toHaveProperty("content_hash");
    expect(parsed).not.toHaveProperty("hash_algorithm");
    expect(parsed).not.toHaveProperty("metadata_is_current");
    // Pin the dropped set: if akb adds another field, this fails and we decide.
    // `created_by_name` was added by REEF-056's live smoke (akb 0.1.0 grew it
    // after the 2026-06-04 capture); reef consciously does not mirror the doc
    // author display name, so it stays in the stripped set.
    expect(
      strippedKeys(DOC_GET_CAPTURE, Object.keys(DocumentResponseSchema.shape)),
    ).toEqual([
      "content_hash",
      "created_by_name",
      "hash_algorithm",
      "metadata_is_current",
    ]);
  });

  it("throws when a required key is renamed (REEF-049 class drift)", () => {
    const { uri: _uri, ...rest } = DOC_GET_CAPTURE;
    expect(() =>
      DocumentResponseSchema.parse({ ...rest, document_uri: _uri }),
    ).toThrow();
  });
});

describe("DocumentPutResponseSchema contract", () => {
  // NOT live (POST/PATCH mutate). Synthesized from akb DocumentPutResponse
  // source: backend/app/models/document.py:128.
  const DOC_PUT_FROM_SOURCE = {
    uri: "akb://reef/coll/issues/doc/reef-001.md",
    vault: "reef",
    path: "issues/reef-001.md",
    commit_hash: "76c72531a7709aff0453696de3d34f11736c8079",
    current_commit: "76c72531a7709aff0453696de3d34f11736c8079",
    previous_commit: "0000000000000000000000000000000000000000",
    content_hash:
      "e806a291cfc3e61f83b98d344ee57e3e8933cccece4fb45e1481f1f560e70eb1",
    previous_content_hash: null,
    hash_algorithm: "sha256",
    action: "updated",
    chunks_indexed: 1,
    entities_found: 0,
  };

  it("parses the akb put response shape", () => {
    const parsed = DocumentPutResponseSchema.parse(DOC_PUT_FROM_SOURCE);
    expect(parsed.commit_hash).toBe(DOC_PUT_FROM_SOURCE.commit_hash);
    expect(parsed.chunks_indexed).toBe(1);
  });

  it("silently strips akb put keys reef does not mirror", () => {
    expect(
      strippedKeys(
        DOC_PUT_FROM_SOURCE,
        Object.keys(DocumentPutResponseSchema.shape),
      ),
    ).toEqual([
      "action",
      "content_hash",
      "current_commit",
      "hash_algorithm",
      "previous_commit",
      "previous_content_hash",
    ]);
  });
});

describe("AkbSqlResponseSchema contract", () => {
  // Live: POST /api/v1/tables/reef/sql, "SELECT document_uri, reef_id, status ..."
  // `document_uri` is the CANONICAL coll/.../doc/... form: writeIssue stores
  // akb_put's `put.uri` verbatim (issues.ts), akb returns it canonically, and
  // akb search returns hit URIs in the same canonical form — so searchIssues'
  // join (`document_uri IN (hit.uri ...)`) lines up. (A pre-canonical dev vault
  // can still hold older `akb://reef/doc/issues/...` rows; current code writes
  // canonical, so normalizing that older data is a separate concern, out of
  // scope for REEF-050.)
  const SQL_QUERY_CAPTURE = {
    kind: "table_query",
    vaults: ["reef"],
    columns: ["document_uri", "reef_id", "status"],
    items: [
      {
        document_uri: "akb://reef/coll/issues/doc/reef-001.md",
        reef_id: "REEF-001",
        status: "in_review",
      },
      {
        document_uri: "akb://reef/coll/issues/doc/reef-003.md",
        reef_id: "REEF-003",
        status: "in_progress",
      },
    ],
    total: 2,
  };

  // Live: POST /api/v1/tables/reef/sql, "UPDATE ... WHERE reef_id = '__none__'"
  const SQL_MUTATION_CAPTURE = {
    kind: "table_sql",
    vaults: ["reef"],
    result: "UPDATE 0",
  };

  it("parses live table_query / table_sql through the discriminated union", () => {
    const query = AkbSqlResponseSchema.parse(SQL_QUERY_CAPTURE);
    expect(query.kind).toBe("table_query");
    if (query.kind === "table_query") {
      expect(query.columns).toEqual(["document_uri", "reef_id", "status"]);
      expect(query.total).toBe(2);
    }
    const mutation = AkbSqlResponseSchema.parse(SQL_MUTATION_CAPTURE);
    expect(mutation.kind).toBe("table_sql");
    if (mutation.kind === "table_sql") {
      expect(mutation.result).toBe("UPDATE 0");
    }
  });

  it("mirrors akb's SQL envelopes exactly — no silently stripped keys", () => {
    expect(
      strippedKeys(
        SQL_QUERY_CAPTURE,
        Object.keys(AkbSqlQueryResponseSchema.shape),
      ),
    ).toEqual([]);
    expect(
      strippedKeys(
        SQL_MUTATION_CAPTURE,
        Object.keys(AkbSqlMutationResponseSchema.shape),
      ),
    ).toEqual([]);
  });

  it("throws when the `kind` discriminator is renamed", () => {
    const { kind: _kind, ...rest } = SQL_QUERY_CAPTURE;
    expect(() =>
      AkbSqlResponseSchema.parse({ ...rest, type: "table_query" }),
    ).toThrow();
  });
});

describe("AkbSearchResponseSchema / AkbSearchHitSchema contract", () => {
  // Live: GET /api/v1/search?vault=reef&q=reef&limit=3 (0 hits for the vault).
  const SEARCH_ENVELOPE_CAPTURE = {
    query: "reef",
    total: 0,
    returned: 0,
    total_matches: 0,
    truncated: false,
    hint: null,
    results: [],
  };

  // NOT live (search returned 0 hits). Synthesized from akb SearchResult
  // source: backend/app/models/document.py:198. Note akb keys the doc type as
  // `doc_type` (not `type`) and includes `path` — neither is named by reef.
  const SEARCH_HIT_FROM_SOURCE = {
    source_type: "document",
    uri: "akb://reef/coll/issues/doc/reef-001.md",
    vault: "reef",
    path: "issues/reef-001.md",
    title: "REEF-001",
    collection: "issues",
    doc_type: "task",
    summary: "Testing",
    tags: ["feat"],
    score: 0.42,
    matched_section: "Testing",
  };

  it("parses the live search envelope (akb uses the `results` key) and keeps akb-only envelope fields via passthrough", () => {
    const parsed = AkbSearchResponseSchema.parse(
      SEARCH_ENVELOPE_CAPTURE,
    ) as Record<string, unknown>;
    expect(parsed.results ?? parsed.items).toEqual([]);
    // `.passthrough()` keeps akb's richer envelope (returned/total_matches/...).
    expect(parsed).toHaveProperty("total_matches", 0);
    expect(parsed).toHaveProperty("truncated", false);
  });

  it("preserves akb hit fields reef does not name (path, doc_type) via passthrough", () => {
    const parsed = AkbSearchHitSchema.parse(SEARCH_HIT_FROM_SOURCE) as Record<
      string,
      unknown
    >;
    expect(parsed.uri).toBe(SEARCH_HIT_FROM_SOURCE.uri);
    // passthrough → akb keys survive verbatim (not stripped).
    expect(parsed).toHaveProperty("doc_type", "task");
    expect(parsed).toHaveProperty("path", "issues/reef-001.md");
  });

  it("no longer declares the dead `type` mirror (akb sends `doc_type`)", () => {
    expect(AkbSearchHitSchema.shape).not.toHaveProperty("type");
    expect(AkbSearchHitSchema.shape).toHaveProperty("source_type");
  });
});

describe("searchDocuments request contract", () => {
  // The contract is not the RESPONSE shape — the REQUEST params should match
  // akb too. akb's GET /api/v1/search takes the search term as `q` (a REQUIRED
  // query param); the older `query` key omits `q` and 422s, so semantic search
  // does not reach akb. reverse-move guard for the REEF-050 contract review.
  it("sends the search term as akb's required `q` param, never `query`", async () => {
    const seenQuery: Array<Record<string, unknown> | undefined> = [];
    const adapter: AkbAdapter = {
      request: async (path, init) => {
        expect(path).toBe("/api/v1/search");
        seenQuery.push(init?.query as Record<string, unknown> | undefined);
        return { results: [] };
      },
    };
    await searchDocuments({
      adapter,
      vault: "reef-test",
      query: "contract drift",
      limit: 5,
    });
    expect(seenQuery[0]).toMatchObject({ q: "contract drift" });
    expect(seenQuery[0]).not.toHaveProperty("query");
  });
});
