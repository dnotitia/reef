import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActiveVault, mockSetActiveVaultDexie } = vi.hoisted(() => ({
  mockGetActiveVault: vi.fn(),
  mockSetActiveVaultDexie: vi.fn(),
}));

vi.mock("@/lib/storage/config", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/config")>(
    "@/lib/storage/config",
  );
  return {
    ...actual,
    getActiveVault: mockGetActiveVault,
    setActiveVault: mockSetActiveVaultDexie,
  };
});

import { useActiveVault, useSetActiveVault } from "./useActiveVault";

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useActiveVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the active vault from Dexie via getActiveVault", async () => {
    mockGetActiveVault.mockResolvedValue("reef-acme");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useActiveVault(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.vault).toBe("reef-acme"));
    expect(mockGetActiveVault).toHaveBeenCalledOnce();
  });

  it('returns vault="" when Dexie has no value', async () => {
    mockGetActiveVault.mockResolvedValue("");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useActiveVault(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.vault).toBe("");
  });

  it("isLoading stays true while query is pending (covers persist-restoration window)", () => {
    mockGetActiveVault.mockReturnValue(new Promise(() => {})); // does not resolves
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useActiveVault(), {
      wrapper: makeWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);
  });
});

describe("useSetActiveVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes via setActiveVault and primes the active-vault cache", async () => {
    mockSetActiveVaultDexie.mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useSetActiveVault(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync("reef-zen");
    });

    expect(mockSetActiveVaultDexie).toHaveBeenCalledWith("reef-zen");
    expect(queryClient.getQueryData(["active-vault"])).toBe("reef-zen");
  });

  it("invalidates config / issues / issue-templates on vault switch", async () => {
    mockSetActiveVaultDexie.mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useSetActiveVault(), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync("reef-zen");
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["config"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["issues"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["issue-templates"],
    });
  });
});
