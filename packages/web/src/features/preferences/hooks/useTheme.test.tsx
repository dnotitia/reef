// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../lib/storage/db";
import { useThemeStore } from "../stores/useThemeStore";
import { useTheme } from "./useTheme";

function resetStore() {
  useThemeStore.setState({ theme: null, hydrated: false, hydrating: false });
}

describe("useTheme", () => {
  beforeEach(async () => {
    resetStore();
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    await db.config.clear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        matches: false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(async () => {
    resetStore();
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    await db.config.clear();
  });

  it("setTheme persists to IndexedDB, updates state, and toggles the class", async () => {
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    const row = await db.config.where("key").equals("theme").first();
    expect(row?.value).toBe("dark");
  });

  it("setTheme to 'light' removes the .dark class even from a dark start", async () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await result.current.setTheme("light");
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  // The whole point of REEF-095: two controls (e.g. Settings Appearance and the
  // account-menu toggle) are separate hook instances, but they should show the
  // same selection. Before the Zustand store, each useTheme had its own
  // useState and the second instance went stale.
  it("shares one selection cursor across separate instances (REEF-095)", async () => {
    const settings = renderHook(() => useTheme());
    const menu = renderHook(() => useTheme());

    await act(async () => {
      await settings.result.current.setTheme("dark");
    });

    expect(settings.result.current.theme).toBe("dark");
    expect(menu.result.current.theme).toBe("dark");

    await act(async () => {
      await menu.result.current.setTheme("light");
    });

    expect(menu.result.current.theme).toBe("light");
    expect(settings.result.current.theme).toBe("light");
  });

  it("reflects store hydration in every instance", async () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBeNull();

    await act(async () => {
      await useThemeStore.getState().setTheme("system");
    });

    await waitFor(() => expect(result.current.theme).toBe("system"));
  });
});
