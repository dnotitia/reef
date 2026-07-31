import { apiFetch } from "@/lib/apiClient";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePendingSuggestionsCount } from "./usePendingSuggestionsCount";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);

function makeWrapper(
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const wrapper = makeWrapper();

function makeDraft(id: string) {
  return {
    id,
    kind: "draft" as const,
    proposal: {
      operation: "create" as const,
      create: {
        fields: { title: `Draft ${id}` },
        content: "Description",
      },
    },
    repo: "owner/repo",
    fingerprint: `owner/repo:commit:${id}`,
    provenance: {
      type: "commit" as const,
      ref: id,
      repo: "owner/repo",
      actor: "actor",
      detectedAt: "2026-07-28T00:00:00.000Z",
    },
    confidence: 0.9,
    reasoning: "Reason",
    status: "pending" as const,
    created_at: "2026-07-28T00:00:00.000Z",
    detected_at: "2026-07-28T00:00:00.000Z",
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("usePendingSuggestionsCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts every pending suggestion without consulting a visit marker", async () => {
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          suggestions: [
            {
              id: "reef-draft-0000000000000001",
              kind: "draft",
              proposal: {
                operation: "create",
                create: {
                  fields: { title: "Draft one" },
                  content: "Description",
                },
              },
              repo: "owner/repo",
              fingerprint: "owner/repo:commit:one",
              provenance: {
                type: "commit",
                ref: "one",
                repo: "owner/repo",
                actor: "actor",
                detectedAt: "2026-07-28T00:00:00.000Z",
              },
              confidence: 0.9,
              reasoning: "Reason",
              status: "pending",
              created_at: "2026-07-28T00:00:00.000Z",
              detected_at: "2026-07-28T00:00:00.000Z",
            },
            {
              id: "reef-draft-0000000000000002",
              kind: "draft",
              proposal: {
                operation: "create",
                create: {
                  fields: { title: "Draft two" },
                  content: "Description",
                },
              },
              repo: "owner/repo",
              fingerprint: "owner/repo:commit:two",
              provenance: {
                type: "commit",
                ref: "two",
                repo: "owner/repo",
                actor: "actor",
                detectedAt: "2026-07-27T00:00:00.000Z",
              },
              confidence: 0.8,
              reasoning: "Reason",
              status: "pending",
              created_at: "2026-07-27T00:00:00.000Z",
              detected_at: "2026-07-27T00:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(
      () => usePendingSuggestionsCount("reef-acme"),
      { wrapper },
    );

    await waitFor(() => expect(result.current).toBe(2));
    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/activity/suggestions?vault=reef-acme&status=pending",
      { cache: "no-store" },
    );
  });

  it("revalidates a recently persisted pending count on mount", async () => {
    const queryClient = makeQueryClient();
    queryClient.setQueryData(["activity-suggestions", "reef-acme", "pending"], {
      suggestions: [
        makeDraft("reef-draft-0000000000000001"),
        makeDraft("reef-draft-0000000000000002"),
        makeDraft("reef-draft-0000000000000003"),
        makeDraft("reef-draft-0000000000000004"),
      ],
    });
    mockedApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          suggestions: [
            makeDraft("reef-draft-0000000000000001"),
            makeDraft("reef-draft-0000000000000002"),
            makeDraft("reef-draft-0000000000000003"),
          ],
        }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(
      () => usePendingSuggestionsCount("reef-acme"),
      { wrapper: makeWrapper(queryClient) },
    );

    expect(result.current).toBe(4);
    await waitFor(() => expect(result.current).toBe(3));
    expect(mockedApiFetch).toHaveBeenCalledOnce();
  });
});
