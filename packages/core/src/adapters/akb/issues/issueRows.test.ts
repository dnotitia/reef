import { afterEach, describe, expect, it, vi } from "vitest";
import { SchemaValidationError } from "../../../errors";
import { makeSqlQueryResponse } from "../core/sqlTestSupport";
import {
  makeAdapter,
  sqlRequestBody,
  setupFetch,
} from "../core/httpTestSupport";
import { hydrateIssuesByDocumentUri, rowToIssue } from "./issueRows";

// A minimal, schema-valid `reef_issues` row as akb's SQL endpoint returns it:
// `meta` is a decoded object (not JSON text) and the semantic actors live under
// `meta.author` / `meta.last_editor`. Tests spread over this and override the
// one field under test.
function validRow(
  metaOverride: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    reef_id: "CODE-100",
    title: "Resilient row mapping",
    status: "todo",
    issue_type: "task",
    created_at: "2026-06-25T00:00:00.000Z",
    updated_at: "2026-06-25T00:00:00.000Z",
    labels: [],
    depends_on: [],
    related_to: [],
    blocks: [],
    meta: {
      author: "alice",
      last_editor: "alice",
      source: "ai-agent:user_request",
      last_status_change: null,
      external_refs: null,
      implementation_refs: null,
      watchers: null,
      reviewers: null,
      qa_owner: null,
      custom_fields: null,
      ...metaOverride,
    },
  };
}

describe("rowToIssue meta-ref resilience", () => {
  it("drops invalid implementation_refs entries but keeps the valid ones and the issue", () => {
    const issue = rowToIssue(
      validRow({
        implementation_refs: [
          // missing the required `ref` (writer used `name`) → dropped
          {
            type: "branch",
            name: "feat/x",
            url: "https://github.com/o/r/tree/feat/x",
          },
          // unknown `type` not in the enum → dropped
          { type: "evidence", path: "docs/x.md" },
          // valid → kept
          {
            type: "pull_request",
            ref: "205",
            url: "https://github.com/o/r/pull/205",
          },
        ],
      }),
    );

    expect(issue.id).toBe("CODE-100");
    expect(issue.implementation_refs).toEqual([
      {
        type: "pull_request",
        ref: "205",
        url: "https://github.com/o/r/pull/205",
      },
    ]);
  });

  it("keeps the issue visible when EVERY implementation_ref is invalid (CODE-021/022 regression)", () => {
    // The exact shape that hid CODE-021/022: a `branch`/`commit`/`pull_request`
    // keyed by `name`/`sha`/`number` (no `ref`) plus an `evidence` entry. Before
    // the fix this threw and the issue vanished from every view; now it parses
    // with `implementation_refs` simply omitted.
    const issue = rowToIssue(
      validRow({
        implementation_refs: [
          { type: "branch", name: "feat/code-021" },
          { type: "commit", sha: "7e9da03" },
          { type: "pull_request", number: 205, draft: true },
          { type: "evidence", path: "docs/windows/evidence.md" },
        ],
      }),
    );

    expect(issue.id).toBe("CODE-100");
    expect(issue.implementation_refs).toBeUndefined();
  });

  it("sanitizes external_refs the same way", () => {
    const issue = rowToIssue(
      validRow({
        external_refs: [
          // neither `ref` nor `url` → refine fails → dropped
          { type: "other" },
          // valid
          { type: "other", ref: "docs/x.md", label: "evidence" },
        ],
      }),
    );

    expect(issue.external_refs).toEqual([
      { type: "other", ref: "docs/x.md", label: "evidence" },
    ]);
  });

  it("passes valid refs through unchanged", () => {
    const refs = [
      {
        type: "commit",
        ref: "abc123",
        url: "https://github.com/o/r/commit/abc123",
      },
    ];
    const issue = rowToIssue(validRow({ implementation_refs: refs }));
    expect(issue.implementation_refs).toEqual(refs);
  });

  it("treats a non-array meta ref field as no refs rather than throwing", () => {
    const issue = rowToIssue(validRow({ implementation_refs: "not-an-array" }));
    expect(issue.implementation_refs).toBeUndefined();
    expect(issue.id).toBe("CODE-100");
  });

  it("still throws on a genuinely corrupt core field (resilience is scoped to meta refs)", () => {
    expect(() => rowToIssue({ ...validRow(), status: "nope" })).toThrow(
      SchemaValidationError,
    );
  });
});

function hydrationRow(
  documentUri: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...validRow(),
    document_uri: documentUri,
    ...overrides,
  };
}

describe("hydrateIssuesByDocumentUri", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deduplicates URIs and binds them in SQL parameter order", async () => {
    const firstUri = "akb://reef/coll/issues/doc/first-'한글😀.md";
    const missingUri = "akb://reef/coll/issues/doc/missing.md";
    const { calls } = setupFetch([
      {
        body: makeSqlQueryResponse([hydrationRow(firstUri)], ["document_uri"]),
      },
    ]);

    const issues = await hydrateIssuesByDocumentUri(
      // The duplicate must not become a duplicate SQL value or map entry.
      makeAdapter(),
      "reef",
      [firstUri, firstUri, missingUri],
    );

    expect([...issues.keys()]).toEqual([firstUri]);
    const request = sqlRequestBody(calls[0]);
    expect(request.sql).toBe(
      "SELECT * FROM reef_issues WHERE document_uri IN ($1, $2)",
    );
    expect(request.params).toEqual([firstUri, missingUri]);
    expect(request.sql).not.toContain(firstUri);
  });

  it("skips missing, archived, and malformed rows independently", async () => {
    const visibleUri = "akb://reef/coll/issues/doc/visible.md";
    const archivedUri = "akb://reef/coll/issues/doc/archived.md";
    const malformedUri = "akb://reef/coll/issues/doc/malformed.md";
    setupFetch([
      {
        body: makeSqlQueryResponse(
          [
            hydrationRow(archivedUri, {
              archived_at: "2026-07-03T00:00:00.000Z",
            }),
            hydrationRow(malformedUri, { status: "invalid" }),
            hydrationRow(visibleUri),
          ],
          ["document_uri"],
        ),
      },
    ]);

    const issues = await hydrateIssuesByDocumentUri(makeAdapter(), "reef", [
      "akb://reef/coll/issues/doc/missing.md",
      archivedUri,
      malformedUri,
      visibleUri,
    ]);

    expect([...issues.keys()]).toEqual([visibleUri]);
    expect(issues.get(visibleUri)?.id).toBe("CODE-100");
  });

  it("rejects a NUL URI before making the SQL request", async () => {
    const { calls } = setupFetch([]);

    await expect(
      hydrateIssuesByDocumentUri(makeAdapter(), "reef", [
        "akb://reef/coll/issues/doc/bad\0uri.md",
      ]),
    ).rejects.toBeInstanceOf(SchemaValidationError);
    expect(calls).toHaveLength(0);
  });
});
