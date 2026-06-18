import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "@/lib/apiClient";
import { commentsKey } from "../queries/useComments";
import { useCreateComment } from "./useCreateComment";

const mockApiFetch = vi.mocked(apiFetch);

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

const EXISTING = {
  id: "00000000-0000-4000-8000-000000000000",
  reef_id: "REEF-001",
  body: "earlier",
  author: "bob",
  created_at: "2026-06-18T00:00:00.000Z",
  edited_at: null,
};
const CREATED = {
  id: "11111111-1111-4111-8111-111111111111",
  reef_id: "REEF-001",
  body: "new one",
  author: "alice",
  created_at: "2026-06-18T01:00:00.000Z",
  edited_at: null,
};

describe("useCreateComment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs the body and appends the server comment to the cached thread", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ comment: CREATED }), { status: 201 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(commentsKey("reef-acme", "REEF-001"), [EXISTING]);

    const { result } = renderHook(() => useCreateComment(), {
      wrapper: wrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        issueId: "REEF-001",
        vault: "reef-acme",
        body: "new one",
      });
    });

    const [url, init] = mockApiFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/issues/REEF-001/comments?vault=reef-acme");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ body: "new one" });
    expect(
      queryClient.getQueryData(commentsKey("reef-acme", "REEF-001")),
    ).toEqual([EXISTING, CREATED]);
  });
});
