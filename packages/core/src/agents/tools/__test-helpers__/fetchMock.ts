import { vi } from "vitest";
import { type AkbAdapter, createAkbAdapter } from "../../../adapters/akb";
import type { IssueMetadata } from "../../../schemas/issues/metadata";

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface FetchResponseSpec {
  status?: number;
  body?: unknown;
}

/**
 * Install a queue-backed global fetch mock and return the captured-call log.
 *
 * Each `responses` entry is consumed by the next fetch call in order;
 * exhausting the queue throws so unexpected requests surface loudly instead
 * of silently returning `undefined`. Replaces the ~18-line `setupFetch`
 * helper previously duplicated across the four core tool tests.
 *
 * Callers should pair this with `vi.unstubAllGlobals()` in an `afterEach` block
 * to avoid leaking the fetch stub between tests.
 */
export function setupFetch(responses: FetchResponseSpec[]): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`No mocked response for ${url}`);
    const status = next.status ?? 200;
    return new Response(JSON.stringify(next.body ?? {}), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

/**
 * Construct a per-test akb adapter bound to a deterministic base URL and
 * placeholder JWT. The fetch stub from {@link setupFetch} intercepts every
 * request the returned adapter makes.
 */
export function makeTestAkbAdapter(): AkbAdapter {
  return createAkbAdapter({
    baseUrl: "https://akb.test",
    jwt: "jwt.example.token",
  });
}

/**
 * A reef_issues row as akb returns it from a SELECT (json columns
 * pre-decoded). reef's read path reconstructs the Issue from this row, so
 * tool tests that exercise `readIssue`/`listIssues` pair a document response
 * (for the body) with one of these via {@link makeIssueQueryResponse}.
 */
function makeIssueRow(issue: IssueMetadata): Record<string, unknown> {
  return {
    id: 1,
    document_uri: `akb://reef-acme/doc/issues/${issue.id.toLowerCase()}.md`,
    reef_id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority ?? null,
    assigned_to: issue.assigned_to ?? null,
    labels: issue.labels ?? [],
    depends_on: issue.depends_on ?? [],
    blocks: issue.blocks ?? [],
    rank: issue.rank ?? null,
    archived_at: issue.archived_at ?? null,
    meta: {
      author: issue.created_by,
      last_editor: issue.updated_by,
      source: issue.source ?? null,
      last_status_change: issue.last_status_change ?? null,
    },
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    created_by: "akb-principal",
  };
}

/** Wrap issue rows in akb's `table_query` SQL response envelope. */
export function makeIssueQueryResponse(issues: IssueMetadata[]): unknown {
  const items = issues.map(makeIssueRow);
  return {
    kind: "table_query",
    columns: items.length > 0 ? Object.keys(items[0] as object) : [],
    items,
    total: items.length,
  };
}
