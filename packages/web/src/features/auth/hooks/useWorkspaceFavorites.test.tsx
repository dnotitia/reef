import "fake-indexeddb/auto";

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/storage/db";
import {
  getWorkspaceFavorites,
  setWorkspaceFavorites,
} from "@/lib/storage/workspaceFavorites";
import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import { useWorkspaceFavorites } from "./useWorkspaceFavorites";

const CANDIDATES = ["reef-alpha", "reef-zeta"] as const;

describe("useWorkspaceFavorites", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.config.clear();
  });

  it("optimistically toggles and restores the previous state after a save failure", async () => {
    await setWorkspaceFavorites(["reef-alpha"]);
    const put = vi
      .spyOn(db.config, "put")
      .mockRejectedValueOnce(new Error("storage unavailable"));
    const { result } = renderHook(() => useWorkspaceFavorites(CANDIDATES));

    await waitFor(() =>
      expect(result.current.favorites).toEqual(["reef-alpha"]),
    );
    await act(async () => {
      await result.current.toggleFavorite("reef-alpha");
    });

    expect(result.current.favorites).toEqual(["reef-alpha"]);
    expect(result.current.hasStorageError).toBe(true);
    put.mockRestore();
  });

  it("clears the in-memory preference when the account cleanup event arrives", async () => {
    await setWorkspaceFavorites(["reef-alpha"]);
    const { result } = renderHook(() => useWorkspaceFavorites(CANDIDATES));

    await waitFor(() =>
      expect(result.current.favorites).toEqual(["reef-alpha"]),
    );
    act(() => window.dispatchEvent(new Event(AUTH_CHANGED_EVENT)));

    expect(result.current.favorites).toEqual([]);
  });

  it("removes favorites that are no longer accessible or configured", async () => {
    await setWorkspaceFavorites(["reef-alpha", "reef-missing", "raw-vault"]);
    const { result } = renderHook(() => useWorkspaceFavorites(CANDIDATES));

    await waitFor(() =>
      expect(result.current.favorites).toEqual(["reef-alpha"]),
    );
    await waitFor(async () =>
      expect(await getWorkspaceFavorites()).toEqual(["reef-alpha"]),
    );
  });
});
