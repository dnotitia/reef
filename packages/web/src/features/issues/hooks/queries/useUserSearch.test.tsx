import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock apiFetch — should happen before the import below. The hook also
// uses `throwHttpError`, so re-export the real implementation alongside
// the mocked fetch.
vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
    apiClient: { fetch: vi.fn() },
  };
});

import { apiFetch } from "@/lib/apiClient";
import { useUserSearch } from "./useUserSearch";

const mockApiFetch = vi.mocked(apiFetch);

const mockCollaborators = [
  {
    login: "alice",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    name: "Alice Kim",
  },
  {
    login: "bob",
    avatar_url: "https://avatars.githubusercontent.com/u/2?v=4",
    name: "Bob Park",
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useUserSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns collaborator list on success", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ users: mockCollaborators }), {
        status: 200,
      }),
    );

    const { result } = renderHook(() => useUserSearch("", "owner/repo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockCollaborators);
  });

  it("is in loading state initially", () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // does not resolves

    const { result } = renderHook(() => useUserSearch("", "owner/repo"), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
  });

  it("surfaces isError on non-200 response", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
      }),
    );

    const { result } = renderHook(() => useUserSearch("", "owner/repo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Authentication required");
  });

  it("is disabled when repo is empty string", () => {
    const { result } = renderHook(() => useUserSearch("", ""), {
      wrapper: createWrapper(),
    });

    // enabled: false → fetchStatus is 'idle' (not fetching)
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("passes query param in URL when query is non-empty", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ users: [mockCollaborators[0]] }), {
        status: 200,
      }),
    );

    const { result } = renderHook(() => useUserSearch("alice", "owner/repo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining("q=alice"),
    );
  });

  it("two different queries produce two separate calls (cache key includes query)", async () => {
    // Query client with no deduplication — each renderHook gets a fresh client
    const results: string[] = [];
    mockApiFetch.mockImplementation(async (url) => {
      results.push(url as string);
      return new Response(JSON.stringify({ users: [] }), { status: 200 });
    });

    const wrapperAlice = createWrapper();
    const wrapperBob = createWrapper();

    const { result: r1 } = renderHook(
      () => useUserSearch("alice", "owner/repo"),
      { wrapper: wrapperAlice },
    );
    const { result: r2 } = renderHook(
      () => useUserSearch("bob", "owner/repo"),
      { wrapper: wrapperBob },
    );

    await waitFor(() => expect(r1.current.isSuccess).toBe(true));
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));

    // Both queries should have fired
    expect(results.some((u) => u.includes("q=alice"))).toBe(true);
    expect(results.some((u) => u.includes("q=bob"))).toBe(true);
  });

  it("empty q does not include q param in URL", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );

    const { result } = renderHook(() => useUserSearch("", "owner/repo"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Should NOT have q= in URL when query is empty
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.not.stringContaining("q="),
    );
  });
});
