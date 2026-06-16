import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/credentials", () => ({
  getGitHubToken: vi.fn(),
}));

import { getGitHubToken } from "@/lib/storage/credentials";
import { useHasGithubToken } from "./useHasGithubToken";

const mockGetGitHubToken = vi.mocked(getGitHubToken);

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useHasGithubToken", () => {
  it("reports hasToken=true when a token is stored", async () => {
    mockGetGitHubToken.mockResolvedValue("ghp_stored");
    const { Wrapper } = createHarness();

    const { result } = renderHook(() => useHasGithubToken(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasToken).toBe(true);
  });

  it("reports hasToken=false when no token is stored", async () => {
    mockGetGitHubToken.mockResolvedValue(undefined);
    const { Wrapper } = createHarness();

    const { result } = renderHook(() => useHasGithubToken(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasToken).toBe(false);
  });

  it("re-evaluates after queryClient.clear() — the reconnect path (REEF-159 AC3)", async () => {
    // Unconfigured first, then a token is saved and the cache is cleared, which
    // is exactly what AUTH_CHANGED_EVENT → queryClient.clear() does in
    // QueryProvider on setGitHubToken. The gate should flip without a remount.
    mockGetGitHubToken.mockResolvedValue(undefined);
    const { Wrapper, queryClient } = createHarness();

    const { result } = renderHook(() => useHasGithubToken(), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.hasToken).toBe(false));

    mockGetGitHubToken.mockResolvedValue("ghp_reconnected");
    queryClient.clear();

    await waitFor(() => expect(result.current.hasToken).toBe(true));
  });

  it("never exposes the token value, only its presence", async () => {
    mockGetGitHubToken.mockResolvedValue("ghp_secret");
    const { Wrapper } = createHarness();

    const { result } = renderHook(() => useHasGithubToken(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(JSON.stringify(result.current)).not.toContain("ghp_secret");
    expect(result.current).toEqual({ hasToken: true, isLoading: false });
  });
});
