import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Let the real throwHttpError flow through — it just parses res.json()
// and throws an HttpError, exactly what the hook expects on !res.ok.
vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return {
    ...actual,
    apiFetch: vi.fn(),
    apiClient: { fetch: vi.fn() },
  };
});

// useRepos gates its fetch on the deployment-managed GitHub App (REEF-244).
const appState = vi.hoisted(() => ({
  current: {
    isAvailable: true,
    isLoading: false,
    appId: null as string | null,
  },
}));
vi.mock("@/features/settings/hooks/useGithubAppAvailable", () => ({
  useGithubAppAvailable: () => appState.current,
}));

import { apiFetch } from "@/lib/apiClient";
import { useRepos } from "./useRepos";

const mockApiFetch = vi.mocked(apiFetch);
const ETAG_KEY = "reef:etag:repos:installation:list:v3";
const LEGACY_PAT_ETAG_KEY = "reef:etag:repos:list:v2";

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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  appState.current = { isAvailable: true, isLoading: false, appId: "123456" };
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useRepos", () => {
  it("fetches and stores the response ETag on the cold path", async () => {
    const repos = [
      { full_name: "owner/a", id: 1 },
      { full_name: "owner/b", id: 2 },
    ];
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ repos }), {
        status: 200,
        headers: { etag: 'W/"v1"' },
      }),
    );

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(repos);
    expect(window.localStorage.getItem(ETAG_KEY)).toBe('W/"v1"');
    // Cold path: unconditional fetch, no init arg.
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    expect(mockApiFetch.mock.calls[0]).toEqual(["/api/repos"]);
  });

  it("sends If-None-Match from localStorage and updates the ETag on 200", async () => {
    window.localStorage.setItem(ETAG_KEY, 'W/"prev"');
    mockApiFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ repos: [{ full_name: "owner/a", id: 1 }] }),
        {
          status: 200,
          headers: { etag: 'W/"next"' },
        },
      ),
    );

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const first = mockApiFetch.mock.calls[0];
    expect(
      (first?.[1] as { headers?: Headers })?.headers?.get("If-None-Match"),
    ).toBe('W/"prev"');
    expect(window.localStorage.getItem(ETAG_KEY)).toBe('W/"next"');
  });

  it("ignores the legacy PAT-backed ETag key after the App migration (REEF-244)", async () => {
    window.localStorage.setItem(LEGACY_PAT_ETAG_KEY, 'W/"pat-era"');
    const repos = [{ full_name: "octo/reef", id: 1001 }];
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ repos }), {
        status: 200,
        headers: { etag: 'W/"app-era"' },
      }),
    );

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(repos);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/repos");
    expect(window.localStorage.getItem(LEGACY_PAT_ETAG_KEY)).toBe(
      'W/"pat-era"',
    );
    expect(window.localStorage.getItem(ETAG_KEY)).toBe('W/"app-era"');
  });

  it("recovers when 304 arrives without any cached body (ETag survived a cache wipe)", async () => {
    // ETag key persists but the query body cache was evicted. 304 then
    // would otherwise pin the picker to an empty list for staleTime.
    window.localStorage.setItem(ETAG_KEY, 'W/"stale"');

    const freshRepos = [{ full_name: "owner/fresh", id: 9 }];
    mockApiFetch
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ repos: freshRepos }), {
          status: 200,
          headers: { etag: 'W/"fresh"' },
        }),
      );

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(freshRepos);
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    // Second call is the unconditional recovery — no init arg.
    expect(mockApiFetch.mock.calls[1]).toEqual(["/api/repos"]);
    expect(window.localStorage.getItem(ETAG_KEY)).toBe('W/"fresh"');
  });

  it("treats 304 as success when the in-memory cache still has the listing", async () => {
    // Seed via a 200 response, then refetch and receive 304 — the hook
    // should return the cached data without re-fetching unconditionally.
    const seedRepos = [{ full_name: "owner/seed", id: 7 }];
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ repos: seedRepos }), {
          status: 200,
          headers: { etag: 'W/"seed"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(seedRepos);

    await result.current.refetch();
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.data).toEqual(seedRepos);
    // Exactly two requests; no recovery refetch was needed.
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("surfaces an error response (e.g. 401) instead of swallowing it", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
      }),
    );

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("Authentication required");
  });

  it("does not fetch at all when the GitHub App is unavailable (REEF-244)", async () => {
    // The deployment-unconfigured case: the query is disabled, so no /api/repos
    // request is ever issued and no 503 can accumulate.
    appState.current = { isAvailable: false, isLoading: false, appId: null };
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ repos: [] }), { status: 200 }),
    );

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    // Give a (wrongly) enabled query time to fire before asserting it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches when the server GitHub App is available (REEF-244)", async () => {
    // The deployment-managed App serves the installation repos; the browser
    // never supplies a GitHub token.
    appState.current = { isAvailable: true, isLoading: false, appId: "123456" };
    const repos = [{ full_name: "octo/reef", id: 1001 }];
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ repos }), { status: 200 }),
    );

    const { result } = renderHook(() => useRepos(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(repos);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/repos");
  });

  it("does not retry an auth 401 — one request, not three (REEF-159)", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
      }),
    );

    // Retry is ENABLED at the client level here to prove the hook itself opts
    // out — without `retry: false` on the query this would fire 3+ times.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: true } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useRepos(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
  });
});
