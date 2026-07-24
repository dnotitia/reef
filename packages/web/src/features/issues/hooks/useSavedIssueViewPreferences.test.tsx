import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetDefault,
  mockGetFavorites,
  mockSetDefault,
  mockClearDefault,
  mockSetFavorites,
} = vi.hoisted(() => ({
  mockGetDefault: vi.fn(),
  mockGetFavorites: vi.fn(),
  mockSetDefault: vi.fn(),
  mockClearDefault: vi.fn(),
  mockSetFavorites: vi.fn(),
}));

vi.mock("@/lib/storage/config", () => ({
  getDefaultIssueViewId: mockGetDefault,
  getFavoriteIssueViewIds: mockGetFavorites,
  setDefaultIssueViewId: mockSetDefault,
  clearDefaultIssueViewId: mockClearDefault,
  setFavoriteIssueViewIds: mockSetFavorites,
}));

import type { SavedIssueView } from "@reef/core";
import { useSavedIssueViewPreferences } from "./useSavedIssueViewPreferences";

const first: SavedIssueView = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "First",
  name_key: "first",
  owner: "alice",
  payload: { version: 1, query: { status: ["todo"] } },
};
const staleId = "22222222-2222-4222-8222-222222222222";

function harness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useSavedIssueViewPreferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDefault.mockResolvedValue(undefined);
    mockGetFavorites.mockResolvedValue([]);
    mockSetDefault.mockResolvedValue(undefined);
    mockClearDefault.mockResolvedValue(undefined);
    mockSetFavorites.mockResolvedValue(undefined);
  });

  it("keeps default and favorite changes independent", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(
      () => useSavedIssueViewPreferences("reef-acme", [first], true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.setFavorite(first.id, true));
    await waitFor(() => expect(result.current.favoriteIds).toEqual([first.id]));
    expect(result.current.defaultId).toBeUndefined();

    await act(() => result.current.setDefault(first.id));
    await waitFor(() => expect(result.current.defaultId).toBe(first.id));
    expect(result.current.favoriteIds).toEqual([first.id]);
  });

  it("removes stale ids after the saved-view list settles", async () => {
    mockGetDefault.mockResolvedValue(staleId);
    mockGetFavorites.mockResolvedValue([first.id, staleId]);
    const { wrapper } = harness();
    const { result } = renderHook(
      () => useSavedIssueViewPreferences("reef-acme", [first], true),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.defaultId).toBeUndefined();
      expect(result.current.favoriteIds).toEqual([first.id]);
    });
    expect(mockClearDefault).toHaveBeenCalledWith("reef-acme");
    expect(mockSetFavorites).toHaveBeenCalledWith("reef-acme", [first.id]);
  });

  it("does not leave optimistic favorite state when Dexie rejects", async () => {
    mockSetFavorites.mockRejectedValue(new Error("IndexedDB unavailable"));
    const { wrapper } = harness();
    const { result } = renderHook(
      () => useSavedIssueViewPreferences("reef-acme", [first], true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.setFavorite(first.id, true)).rejects.toThrow(
        "IndexedDB unavailable",
      );
    });
    expect(result.current.favoriteIds).toEqual([]);
  });

  it("settles with empty preferences when the Dexie read fails", async () => {
    mockGetDefault.mockRejectedValue(new Error("IndexedDB unavailable"));
    const { wrapper } = harness();
    const { result } = renderHook(
      () => useSavedIssueViewPreferences("reef-acme", [first], true),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.defaultId).toBeUndefined();
    expect(result.current.favoriteIds).toEqual([]);
  });
});
