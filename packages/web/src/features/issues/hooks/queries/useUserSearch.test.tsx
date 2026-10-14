import { createQueryWrapper } from "@/test-support/query";

import { renderHook, waitFor } from "@testing-library/react";
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
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockCollaborators);
  });

  it("is in loading state initially", () => {
    mockApiFetch.mockReturnValue(new Promise(() => {})); // does not resolves

    const { result } = renderHook(() => useUserSearch("", "owner/repo"), {
      wrapper: createQueryWrapper(),
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
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Authentication required");
  });

  it("is disabled when repo is empty string", () => {
    const { result } = renderHook(() => useUserSearch("", ""), {
      wrapper: createQueryWrapper(),
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
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.stringContaining("q=alice"),
    );
  });

  it("keeps separate cached results when the query changes on one client", async () => {
    mockApiFetch.mockImplementation(async (url) => {
      const query = new URL(String(url), "https://reef.test").searchParams.get(
        "q",
      );
      return Response.json({
        users:
          query === "alice" ? [mockCollaborators[0]] : [mockCollaborators[1]],
      });
    });
    const { result, rerender } = renderHook(
      ({ query }) => useUserSearch(query, "reef-acme"),
      { initialProps: { query: "alice" }, wrapper: createQueryWrapper() },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual([mockCollaborators[0]]),
    );
    rerender({ query: "bob" });
    await waitFor(() =>
      expect(result.current.data).toEqual([mockCollaborators[1]]),
    );
    rerender({ query: "alice" });
    await waitFor(() =>
      expect(result.current.data).toEqual([mockCollaborators[0]]),
    );
    expect(mockApiFetch.mock.calls.map(([url]) => String(url))).toEqual([
      "/api/vault-members?vault=reef-acme&q=alice",
      "/api/vault-members?vault=reef-acme&q=bob",
    ]);
  });

  it("empty q does not include q param in URL", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ users: [] }), { status: 200 }),
    );

    const { result } = renderHook(() => useUserSearch("", "owner/repo"), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Should NOT have q= in URL when query is empty
    expect(mockApiFetch).toHaveBeenCalledWith(
      expect.not.stringContaining("q="),
    );
  });
});
