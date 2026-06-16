import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCredentials } from "./useCredentials";

// Mock the credentials storage module
vi.mock("@/lib/storage/credentials", () => ({
  getGitHubToken: vi.fn(),
}));

import { getGitHubToken } from "@/lib/storage/credentials";

const mockGetGitHubToken = vi.mocked(getGitHubToken);

describe("useCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no token stored → returns { token: undefined, isLoading: false } after load", async () => {
    mockGetGitHubToken.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCredentials());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.token).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("token present → returns { token: 'ghp_...', isLoading: false } after load", async () => {
    mockGetGitHubToken.mockResolvedValue("ghp_test_token");

    const { result } = renderHook(() => useCredentials());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.token).toBe("ghp_test_token");
    expect(result.current.isLoading).toBe(false);
  });

  it("Dexie error → logs gracefully and returns { token: undefined, isLoading: false }", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetGitHubToken.mockRejectedValue(new Error("Dexie database error"));

    const { result } = renderHook(() => useCredentials());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.token).toBeUndefined();
    expect(result.current.isLoading).toBe(false);

    consoleSpy.mockRestore();
  });

  it("starts with isLoading: true before the Dexie promise resolves", () => {
    // Keep the promise pending
    let resolveToken: (v: string | undefined) => void = () => {};
    mockGetGitHubToken.mockReturnValue(
      new Promise<string | undefined>((resolve) => {
        resolveToken = resolve;
      }),
    );

    const { result } = renderHook(() => useCredentials());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.token).toBeUndefined();

    // Resolve to avoid unhandled promise warning
    act(() => {
      resolveToken(undefined);
    });
  });
});
