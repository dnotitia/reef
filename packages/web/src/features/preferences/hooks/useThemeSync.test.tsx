// @vitest-environment jsdom
import "fake-indexeddb/auto";

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfigValue } from "../../../lib/storage/config";
import { db } from "../../../lib/storage/db";
import { useThemeStore } from "../stores/useThemeStore";
import { useThemeSync } from "./useThemeSync";

function Harness() {
  useThemeSync();
  return null;
}

function resetStore() {
  useThemeStore.setState({ theme: null, hydrated: false, hydrating: false });
}

const addEventListener = vi.fn();
const removeEventListener = vi.fn();

describe("useThemeSync", () => {
  beforeEach(async () => {
    resetStore();
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    await db.config.clear();
    addEventListener.mockClear();
    removeEventListener.mockClear();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((q: string) => ({
        matches: false,
        media: q,
        addEventListener,
        removeEventListener,
      })),
    });
  });

  afterEach(async () => {
    resetStore();
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
    await db.config.clear();
  });

  it("hydrates the stored preference on mount and applies it", async () => {
    await setConfigValue("theme", "dark");

    render(<Harness />);

    await waitFor(() => expect(useThemeStore.getState().theme).toBe("dark"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("subscribes to the OS color-scheme change for the 'system' preference", async () => {
    render(<Harness />); // nothing stored → hydrates to 'system'

    await waitFor(() => expect(useThemeStore.getState().theme).toBe("system"));
    await waitFor(() =>
      expect(addEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      ),
    );
  });

  it("does not subscribe to the OS change for a fixed preference", async () => {
    await setConfigValue("theme", "light");

    render(<Harness />);

    await waitFor(() => expect(useThemeStore.getState().theme).toBe("light"));
    expect(addEventListener).not.toHaveBeenCalled();
  });
});
