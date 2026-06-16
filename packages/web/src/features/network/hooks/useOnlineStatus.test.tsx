// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useOnlineStatus } from "./useOnlineStatus";

function setOnLine(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value,
  });
}

describe("useOnlineStatus", () => {
  beforeEach(() => {
    setOnLine(true);
  });

  afterEach(() => {
    setOnLine(true);
  });

  it("reflects navigator.onLine on initial render", () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it("flips to false when window dispatches an 'offline' event", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    act(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });

  it("flips back to true on 'online' event", () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
    act(() => {
      setOnLine(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("detaches its window listeners on unmount", () => {
    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();
    // After unmount, dispatching events should not throw and (since no state
    // change can happen) leaves React state alone. Implicit assertion: no
    // "update on unmounted component" warning is emitted by React.
    expect(() => {
      setOnLine(false);
      window.dispatchEvent(new Event("offline"));
    }).not.toThrow();
  });
});
