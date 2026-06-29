import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActiveVault, mockSetActiveVaultDexie, paramsRef } = vi.hoisted(
  () => ({
    mockGetActiveVault: vi.fn(),
    mockSetActiveVaultDexie: vi.fn(),
    // Mutable so each test controls the URL `[vault]` segment (REEF-315).
    paramsRef: { current: {} as Record<string, string | string[]> },
  }),
);

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

vi.mock("next/navigation", () => ({
  useParams: () => paramsRef.current,
}));

import {
  useActiveVault,
  useSetActiveVault,
  useSyncActiveVaultFromUrl,
} from "./useActiveVault";

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
    paramsRef.current = {};
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

  it("prefers the URL [vault] segment over the Dexie default (REEF-315)", async () => {
    paramsRef.current = { vault: "reef-url" };
    mockGetActiveVault.mockResolvedValue("reef-dexie");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useActiveVault(), {
      wrapper: makeWrapper(queryClient),
    });

    // The URL is known synchronously, so the URL vault wins immediately and is
    // the hook is not in a loading state.
    expect(result.current.vault).toBe("reef-url");
    expect(result.current.isLoading).toBe(false);
  });

  it("ignores a malformed URL vault and falls back to the Dexie default", async () => {
    paramsRef.current = { vault: "Bad_Vault" }; // uppercase → fails VAULT_NAME_RE
    mockGetActiveVault.mockResolvedValue("reef-dexie");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(() => useActiveVault(), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.vault).toBe("reef-dexie"));
  });
});

describe("useSyncActiveVaultFromUrl (REEF-315)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    paramsRef.current = {};
  });

  it("persists the URL vault to Dexie and primes the cache when it differs", async () => {
    mockGetActiveVault.mockResolvedValue("reef-old");
    mockSetActiveVaultDexie.mockResolvedValue(undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useSyncActiveVaultFromUrl("reef-new"), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() =>
      expect(mockSetActiveVaultDexie).toHaveBeenCalledWith("reef-new"),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(["active-vault"])).toBe("reef-new"),
    );
  });

  it("does not rewrite Dexie when it already matches, but still primes the cache", async () => {
    mockGetActiveVault.mockResolvedValue("reef-same");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useSyncActiveVaultFromUrl("reef-same"), {
      wrapper: makeWrapper(queryClient),
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(["active-vault"])).toBe("reef-same"),
    );
    expect(mockSetActiveVaultDexie).not.toHaveBeenCalled();
  });

  it("no-ops for an empty or malformed vault", async () => {
    mockGetActiveVault.mockResolvedValue("reef-old");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useSyncActiveVaultFromUrl(""), {
      wrapper: makeWrapper(queryClient),
    });

    // Give any (incorrect) async write a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSetActiveVaultDexie).not.toHaveBeenCalled();
    expect(mockGetActiveVault).not.toHaveBeenCalled();
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
