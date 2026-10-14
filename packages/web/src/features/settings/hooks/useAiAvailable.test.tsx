import { createQueryWrapper } from "@/test-support/query";

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAvailable } from "./useAiAvailable";

const mockFetch = vi.fn<typeof fetch>();

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
        model: "deepseek/deepseek-v4-flash",
      }),
    );

    const { result } = renderHook(() => useAiAvailable(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toEqual({
      isAvailable: true,
      isLoading: false,
      model: "deepseek/deepseek-v4-flash",
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/ai/status", {
      credentials: "same-origin",
    });
  });

  it("treats failed status requests as unavailable", async () => {
    mockFetch.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    const { result } = renderHook(() => useAiAvailable(), {
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.model).toBeNull();
  });
});
