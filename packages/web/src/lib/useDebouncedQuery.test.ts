import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SEARCH_DEBOUNCE_COLD,
  SEARCH_DEBOUNCE_WARM,
  useDebouncedQuery,
} from "./useDebouncedQuery";

describe("useDebouncedQuery tier constants (REEF-370)", () => {
  it("exposes the warm tier at 150ms and the cold tier at 300ms", () => {
    // AC2 (warm ~150) + AC3 (cold unified 300). The cadence is a named tier, not
    // a magic number scattered per surface.
    expect(SEARCH_DEBOUNCE_WARM).toBe(150);
    expect(SEARCH_DEBOUNCE_COLD).toBe(300);
  });
});

describe("useDebouncedQuery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults to the cold-tier delay", () => {
    const { result } = renderHook(() => useDebouncedQuery());
    act(() => result.current.onChange("a"));
    expect(result.current.raw).toBe("a");
    expect(result.current.debounced).toBe("");
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_COLD - 1));
    expect(result.current.debounced).toBe("");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.debounced).toBe("a");
  });

  it("reflects each keystroke in raw immediately and settles debounced after the delay", () => {
    const { result } = renderHook(() =>
      useDebouncedQuery(SEARCH_DEBOUNCE_WARM),
    );
    act(() => result.current.onChange("de"));
    expect(result.current.raw).toBe("de");
    // AC6: the single `isDebouncing` signal is true while raw and debounced differ.
    expect(result.current.isDebouncing).toBe(true);
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_WARM));
    expect(result.current.debounced).toBe("de");
    expect(result.current.isDebouncing).toBe(false);
  });

  it("coalesces rapid keystrokes into a single settled value", () => {
    const { result } = renderHook(() =>
      useDebouncedQuery(SEARCH_DEBOUNCE_WARM),
    );
    act(() => result.current.onChange("d"));
    act(() => vi.advanceTimersByTime(100));
    act(() => result.current.onChange("de"));
    act(() => vi.advanceTimersByTime(100));
    // 200ms elapsed, but the last keystroke was 100ms ago (< 150), so the earlier
    // timer was cancelled and nothing has settled yet.
    expect(result.current.debounced).toBe("");
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_WARM - 100));
    expect(result.current.debounced).toBe("de");
  });

  it("reset() clears both values immediately and cancels a pending debounce", () => {
    const { result } = renderHook(() =>
      useDebouncedQuery(SEARCH_DEBOUNCE_COLD),
    );
    act(() => result.current.onChange("foo"));
    act(() => result.current.reset());
    expect(result.current.raw).toBe("");
    expect(result.current.debounced).toBe("");
    expect(result.current.isDebouncing).toBe(false);
    // The cancelled timer must not resurrect the pre-reset value a delay later.
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_COLD));
    expect(result.current.debounced).toBe("");
  });

  it("reset(value) seeds both values immediately", () => {
    const { result } = renderHook(() => useDebouncedQuery());
    act(() => result.current.reset("alice"));
    expect(result.current.raw).toBe("alice");
    expect(result.current.debounced).toBe("alice");
    expect(result.current.isDebouncing).toBe(false);
  });

  it("seeds raw and debounced from the initial value", () => {
    const { result } = renderHook(() =>
      useDebouncedQuery(SEARCH_DEBOUNCE_WARM, "seed"),
    );
    expect(result.current.raw).toBe("seed");
    expect(result.current.debounced).toBe("seed");
    expect(result.current.isDebouncing).toBe(false);
  });
});
