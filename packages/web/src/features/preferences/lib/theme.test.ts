// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_STORAGE_KEY, applyTheme, resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("returns explicit light unchanged", () => {
    expect(resolveTheme("light", () => ({ matches: true }))).toBe("light");
  });

  it("returns explicit dark unchanged", () => {
    expect(resolveTheme("dark", () => ({ matches: false }))).toBe("dark");
  });

  it("returns 'dark' when system pref is dark", () => {
    expect(resolveTheme("system", () => ({ matches: true }))).toBe("dark");
  });

  it("returns 'light' when system pref is light", () => {
    expect(resolveTheme("system", () => ({ matches: false }))).toBe("light");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    // Pin matchMedia so the "system" branch is deterministic.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        // Default to "system prefers light" — individual tests override.
        matches: false,
        media: q,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
  });

  it("adds .dark class when preference is dark", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes .dark class when preference is light", () => {
    document.documentElement.classList.add("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("respects matchMedia when preference is system", () => {
    (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("mirrors the preference into localStorage under the boot-script key", () => {
    applyTheme("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("does not throw when localStorage.setItem rejects (Safari private mode)", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => applyTheme("light")).not.toThrow();
    // The class still flipped even though persistence failed.
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    setItem.mockRestore();
  });
});
