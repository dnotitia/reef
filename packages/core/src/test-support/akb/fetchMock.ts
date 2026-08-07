import { vi } from "vitest";
import { type AkbAdapter, createAkbAdapter } from "../../adapters/akb";
import type { IssueMetadata } from "../../schemas/issues/metadata";

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

export interface FetchResponseSpec {
  status?: number;
  body?: unknown;
  error?: unknown;
}

export function setupFetch(responses: FetchResponseSpec[]): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`No mocked response for ${url}`);
    if (next.error !== undefined) throw next.error;
    return new Response(JSON.stringify(next.body ?? {}), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

export function makeTestAkbAdapter(): AkbAdapter {
  return createAkbAdapter({
    baseUrl: "https://akb.test",
    jwt: "fixture-auth-value",
  });
}

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

export function makeIssueQueryResponse(issues: IssueMetadata[]): unknown {
  const items = issues.map(makeIssueRow);
  return {
    kind: "table_query",
    columns: items.length > 0 ? Object.keys(items[0] as object) : [],
    items,
    total: items.length,
  };
}
