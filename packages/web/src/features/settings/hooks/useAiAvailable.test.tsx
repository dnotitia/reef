import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAvailable } from "./useAiAvailable";

const mockFetch = vi.fn<typeof fetch>();

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

describe("useAiAvailable", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns deployment AI availability from /api/ai/status", async () => {
    mockFetch.mockResolvedValueOnce(
      Response.json({
        isConfigured: true,
        provider: "openrouter",
        model: "deepseek/deepseek-v4-flash",
      }),
    );

    const { result } = renderHook(() => useAiAvailable(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toEqual({
      isAvailable: true,
      isLoading: false,
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash",
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/ai/status", {
      credentials: "same-origin",
    });
  });

  it("treats failed status requests as unavailable", async () => {
    mockFetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    const { result } = renderHook(() => useAiAvailable(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.model).toBeNull();
  });
});
