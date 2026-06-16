// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfigValue } from "../../../lib/storage/config";
import { db } from "../../../lib/storage/db";
import { useThemeStore } from "./useThemeStore";

function resetStore() {
  useThemeStore.setState({ theme: null, hydrated: false, hydrating: false });
}

describe("useThemeStore", () => {
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

  it("hydrate loads the stored preference and applies it", async () => {
    // Seed via the storage helper rather than db.put — db.config's primary key
    // is `++id` with `key` as a secondary index, so a bare `put` without an
    // `id` wouldn't be findable by `getTheme()`'s key-based lookup.
    await setConfigValue("theme", "dark");

    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(useThemeStore.getState().hydrated).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("hydrate defaults to 'system' when nothing is stored", async () => {
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().theme).toBe("system");
  });

  it("hydrate is idempotent — a second call does not clobber a newer value", async () => {
    await setConfigValue("theme", "dark");
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().theme).toBe("dark");

    // A control changed the theme after hydration; re-running hydrate (e.g. a
    // re-mount) should not reset it to the stale stored read.
    useThemeStore.setState({ theme: "light" });
    await useThemeStore.getState().hydrate();

    expect(useThemeStore.getState().theme).toBe("light");
  });

  it("does not revert a theme picked while the initial read is in flight", async () => {
    // Race: the menu/Settings controls are live before hydrate's async Dexie
    // read resolves. A quick switch mid-hydration should win over the stale
    // stored value (autoreview P3).
    await setConfigValue("theme", "system");

    const hydrating = useThemeStore.getState().hydrate(); // suspends on getTheme()
    await useThemeStore.getState().setTheme("dark"); // user picks before it resolves
    await hydrating;

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it("setTheme persists, updates state, and toggles the class", async () => {
    await useThemeStore.getState().setTheme("dark");

    expect(useThemeStore.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    const row = await db.config.where("key").equals("theme").first();
    expect(row?.value).toBe("dark");
  });
});
