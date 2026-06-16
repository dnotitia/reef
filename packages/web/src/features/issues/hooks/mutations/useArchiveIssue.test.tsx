import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";
import { useArchiveIssue } from "./useArchiveIssue";

const mockApiFetch = vi.mocked(apiFetch);

const ISSUE: IssueMetadata = {
  id: "REEF-001",
  title: "Sample",
  status: "todo",
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
};

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useArchiveIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archive sends archived_at: <iso> to PATCH /api/issues/{id}", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: ISSUE, content: "" }), {
        status: 200,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useArchiveIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.archive({ id: "REEF-001", vault: "reef-acme" });
    });

    const body = JSON.parse(mockApiFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.vault).toBe("reef-acme");
    expect(body.update.issue_id).toBe("REEF-001");
    expect(typeof body.update.patch.archived_at).toBe("string");
    // ISO 8601 sanity check
    expect(Number.isNaN(Date.parse(body.update.patch.archived_at))).toBe(false);
  });

  it("unarchive sends archived_at: null (sentinel for key removal)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: ISSUE, content: "" }), {
        status: 200,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useArchiveIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.unarchive({ id: "REEF-001", vault: "reef-acme" });
    });

    const body = JSON.parse(mockApiFetch.mock.calls[0]?.[1]?.body as string);
    expect(body.update).toEqual({
      issue_id: "REEF-001",
      patch: { archived_at: null },
    });
  });
});
