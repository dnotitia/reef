import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlashStore, useIssueFlash } from "./useFlashStore";

beforeEach(() => {
  useFlashStore.setState({ flashedIssueId: null });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useFlashStore", () => {
  it("flashIssue sets the flashed id", () => {
    useFlashStore.getState().flashIssue("REEF-1");
    expect(useFlashStore.getState().flashedIssueId).toBe("REEF-1");
  });

  it("a newer flash supersedes an older one", () => {
    useFlashStore.getState().flashIssue("REEF-1");
    useFlashStore.getState().flashIssue("REEF-2");
    expect(useFlashStore.getState().flashedIssueId).toBe("REEF-2");
  });

  it("clearFlash clears when the id still owns the slot", () => {
    useFlashStore.getState().flashIssue("REEF-1");
    useFlashStore.getState().clearFlash("REEF-1");
    expect(useFlashStore.getState().flashedIssueId).toBeNull();
  });

  it("clearFlash is a no-op when a newer flash took the slot", () => {
    useFlashStore.getState().flashIssue("REEF-1");
    useFlashStore.getState().flashIssue("REEF-2");
    // A stale clear from the first card should not drop REEF-2's flash.
    useFlashStore.getState().clearFlash("REEF-1");
    expect(useFlashStore.getState().flashedIssueId).toBe("REEF-2");
  });
});

describe("useFlashStore expiry", () => {
  it("auto-clears the flash after the flash window, with no subscriber mounted", () => {
    // No renderHook here: proves expiry is store-owned, so an unmounted card
    // (filtered out / routed away) does not leave a stale id behind.
    useFlashStore.getState().flashIssue("REEF-1");
    expect(useFlashStore.getState().flashedIssueId).toBe("REEF-1");
    vi.advanceTimersByTime(2000);
    expect(useFlashStore.getState().flashedIssueId).toBeNull();
  });

  it("a newer flash resets the expiry to the new id", () => {
    useFlashStore.getState().flashIssue("REEF-1");
    vi.advanceTimersByTime(300);
    useFlashStore.getState().flashIssue("REEF-2");
    // Past REEF-1's original deadline, REEF-2 should still be flashing.
    vi.advanceTimersByTime(400);
    expect(useFlashStore.getState().flashedIssueId).toBe("REEF-2");
    vi.advanceTimersByTime(2000);
    expect(useFlashStore.getState().flashedIssueId).toBeNull();
  });
});

describe("useIssueFlash", () => {
  it("returns true only for the currently flashing issue", () => {
    const { result: flashing } = renderHook(() => useIssueFlash("REEF-1"));
    const { result: other } = renderHook(() => useIssueFlash("REEF-2"));
    act(() => {
      useFlashStore.getState().flashIssue("REEF-1");
    });
    expect(flashing.current).toBe(true);
    expect(other.current).toBe(false);
  });

  it("reflects the store auto-clear after the flash window", () => {
    const { result } = renderHook(() => useIssueFlash("REEF-1"));
    act(() => {
      useFlashStore.getState().flashIssue("REEF-1");
    });
    expect(result.current).toBe(true);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(false);
  });
});
