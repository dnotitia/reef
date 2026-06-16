import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
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
import { useCreateIssue } from "./useCreateIssue";

const mockApiFetch = vi.mocked(apiFetch);

const CREATED: IssueMetadata = {
  id: "REEF-042",
  title: "New",
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

describe("useCreateIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs to /api/issues with vault + create input and returns issue", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: CREATED }), { status: 201 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useCreateIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    let returned:
      | { issue: IssueMetadata; failed_references?: string[] }
      | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({
        vault: "reef-acme",
        prefix: "REEF",
        create: { fields: { title: "New" }, content: "## body" },
      });
    });

    expect(returned).toEqual({ issue: CREATED });
    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/issues");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      vault: "reef-acme",
      prefix: "REEF",
      create: { fields: { title: "New" }, content: "## body" },
    });
  });

  it("invalidates ['issues','list',vault] on success", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issue: CREATED }), { status: 201 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        vault: "reef-acme",
        prefix: "REEF",
        create: { fields: { title: "x" }, content: "" },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issues", "list", "reef-acme"],
    });
  });

  it("surfaces error on 422 SchemaValidationError", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid request body." }), {
        status: 422,
      }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useCreateIssue(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current
        .mutateAsync({
          vault: "reef-acme",
          prefix: "REEF",
          create: { fields: { title: "x" }, content: "" },
        })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
