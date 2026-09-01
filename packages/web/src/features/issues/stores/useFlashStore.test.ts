import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useFlashStore,
  useIssueFlash,
  useIssueReorderFlash,
} from "./useFlashStore";

const VAULT = "reef-test";

beforeEach(() => {
  vi.useFakeTimers();
  useFlashStore.setState({
    flashedIssueKeys: new Set(),
    reorderFlashedIssueKeys: new Set(),
  });
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe("useFlashStore", () => {
  it("tracks the flashed issue by vault and id", () => {
    useFlashStore.getState().flashIssue(VAULT, "REEF-1");

    expect([...useFlashStore.getState().flashedIssueKeys]).toEqual([
      `${VAULT}:REEF-1`,
    ]);
  });

  it("keeps simultaneous issue flashes instead of replacing the first one", () => {
    useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    useFlashStore.getState().flashIssue(VAULT, "REEF-2");

    expect(useFlashStore.getState().flashedIssueKeys).toEqual(
      new Set([`${VAULT}:REEF-1`, `${VAULT}:REEF-2`]),
    );
  });

  it("isolates the same issue id across vaults", () => {
    useFlashStore.getState().flashIssue("reef-alpha", "REEF-1");
    useFlashStore.getState().flashIssue("reef-beta", "REEF-1");

    expect(useFlashStore.getState().flashedIssueKeys).toEqual(
      new Set(["reef-alpha:REEF-1", "reef-beta:REEF-1"]),
    );
  });

  it("clearFlash clears only its own issue key", () => {
    useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    useFlashStore.getState().flashIssue(VAULT, "REEF-2");
    useFlashStore.getState().clearFlash(VAULT, "REEF-1");

    expect(useFlashStore.getState().flashedIssueKeys).toEqual(
      new Set([`${VAULT}:REEF-2`]),
    );
  });
});

describe("useFlashStore expiry", () => {
  it("auto-clears a flash after the flash window without a subscriber", () => {
    useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    expect(useFlashStore.getState().flashedIssueKeys).toContain(
      `${VAULT}:REEF-1`,
    );

    vi.advanceTimersByTime(2000);

    expect(useFlashStore.getState().flashedIssueKeys).toEqual(new Set());
  });

  it("expires each simultaneous flash independently", () => {
    useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    vi.advanceTimersByTime(300);
    useFlashStore.getState().flashIssue(VAULT, "REEF-2");

    vi.advanceTimersByTime(200);
    expect(useFlashStore.getState().flashedIssueKeys).toEqual(
      new Set([`${VAULT}:REEF-1`, `${VAULT}:REEF-2`]),
    );

    vi.advanceTimersByTime(100);
    expect(useFlashStore.getState().flashedIssueKeys).toEqual(
      new Set([`${VAULT}:REEF-2`]),
    );

    vi.advanceTimersByTime(300);
    expect(useFlashStore.getState().flashedIssueKeys).toEqual(new Set());
  });
});

describe("useIssueFlash", () => {
  it("returns true only for the currently flashing vault and issue", () => {
    const { result: flashing } = renderHook(() =>
      useIssueFlash(VAULT, "REEF-1"),
    );
    const { result: otherIssue } = renderHook(() =>
      useIssueFlash(VAULT, "REEF-2"),
    );
    const { result: otherVault } = renderHook(() =>
      useIssueFlash("reef-other", "REEF-1"),
    );

    act(() => {
      useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    });

    expect(flashing.current).toBe(true);
    expect(otherIssue.current).toBe(false);
    expect(otherVault.current).toBe(false);
  });

  it("distinguishes a reorder success pulse from a regular issue save", () => {
    const { result: reorder } = renderHook(() =>
      useIssueReorderFlash(VAULT, "REEF-1"),
    );
    const { result: regular } = renderHook(() =>
      useIssueFlash(VAULT, "REEF-1"),
    );

    act(() => {
      useFlashStore.getState().flashIssue(VAULT, "REEF-1", "reorder");
    });

    expect(reorder.current).toBe(true);
    expect(regular.current).toBe(true);
  });

  it("does not mark a regular issue save as a reorder pulse", () => {
    const { result } = renderHook(() => useIssueReorderFlash(VAULT, "REEF-1"));

    act(() => {
      useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    });

    expect(result.current).toBe(false);
  });

  it("keeps reorder source identity while other issues flash concurrently", () => {
    useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    useFlashStore.getState().flashIssue(VAULT, "REEF-2", "reorder");

    expect(useFlashStore.getState().flashedIssueKeys).toEqual(
      new Set([`${VAULT}:REEF-1`, `${VAULT}:REEF-2`]),
    );
    expect(useFlashStore.getState().reorderFlashedIssueKeys).toEqual(
      new Set([`${VAULT}:REEF-2`]),
    );
  });

  it("reflects store expiry after the flash window", () => {
    const { result } = renderHook(() => useIssueFlash(VAULT, "REEF-1"));

    act(() => {
      useFlashStore.getState().flashIssue(VAULT, "REEF-1");
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current).toBe(false);
  });
});
