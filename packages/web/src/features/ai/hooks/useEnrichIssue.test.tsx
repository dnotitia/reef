import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "@/lib/apiClient";
import type { EnrichmentRequest } from "@reef/core";
import { useEnrichIssue } from "./useEnrichIssue";

const mockApiFetch = vi.mocked(apiFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const REQUEST: EnrichmentRequest = {
  issueId: "REEF-001",
  vault: "reef-acme",
  draft: {
    fields: {
      title: "Fix login bug",
      issue_type: "bug",
      priority: null,
      assigned_to: null,
      requester: null,
      reporter: null,
      start_date: null,
      due_date: null,
      milestone_id: null,
      sprint_id: null,
      release_id: null,
      estimate_points: null,
      severity: null,
      parent_id: null,
      labels: [],
      depends_on: [],
      blocks: [],
      related_to: [],
      external_refs: [],
    },
    content: "OAuth expires unexpectedly",
  },
  repoContext: {
    owner: "octo",
    repo: "cat",
  },
};

describe("useEnrichIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /api/enrich and returns the parsed result", async () => {
    const result = {
      suggestions: [
        {
          field: "priority",
          value: "high",
          reasoning: "Auth is critical.",
          confidence: 0.9,
        },
      ],
    };
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(result), { status: 200 }),
    );

    const { result: hook } = renderHook(() => useEnrichIssue(), {
      wrapper: createWrapper(),
    });

    let returned: unknown;
    await act(async () => {
      returned = await hook.current.mutateAsync(REQUEST);
    });

    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/enrich");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(REQUEST);
    expect(returned).toEqual(result);
  });

  it("throws an error carrying status=401 when LLM is unconfigured", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "LLM configuration is missing or invalid" }),
        { status: 401 },
      ),
    );

    const { result: hook } = renderHook(() => useEnrichIssue(), {
      wrapper: createWrapper(),
    });

    let caught: unknown;
    try {
      await hook.current.mutateAsync(REQUEST);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { status?: number }).status).toBe(401);
  });

  it("throws an error carrying status=503 on AI unavailable", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "AI enrichment is unavailable." }), {
        status: 503,
      }),
    );

    const { result: hook } = renderHook(() => useEnrichIssue(), {
      wrapper: createWrapper(),
    });

    let caught: unknown;
    try {
      await hook.current.mutateAsync(REQUEST);
    } catch (e) {
      caught = e;
    }
    expect((caught as Error & { status?: number }).status).toBe(503);
    expect((caught as Error).message).toMatch(/unavailable/i);
  });

  it("falls back to a friendly message when the server omits one", async () => {
    mockApiFetch.mockResolvedValueOnce(new Response("{}", { status: 401 }));

    const { result: hook } = renderHook(() => useEnrichIssue(), {
      wrapper: createWrapper(),
    });

    let caught: unknown;
    try {
      await hook.current.mutateAsync(REQUEST);
    } catch (e) {
      caught = e;
    }
    expect((caught as Error).message).toMatch(/Settings/);
  });
});
