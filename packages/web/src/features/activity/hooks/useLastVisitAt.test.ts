import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the config storage module
vi.mock("@/lib/storage/config", () => ({
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
}));

import { getConfigValue, setConfigValue } from "@/lib/storage/config";
import { useLastVisitAt } from "./useLastVisitAt";

const mockedGetConfigValue = vi.mocked(getConfigValue);
const mockedSetConfigValue = vi.mocked(setConfigValue);

describe("useLastVisitAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no value is stored", async () => {
    mockedGetConfigValue.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useLastVisitAt());

    // Initially undefined before effect runs
    expect(result.current.lastVisitAt).toBeUndefined();

    // Wait for effect
    await act(async () => {});

    expect(result.current.lastVisitAt).toBeUndefined();
    expect(mockedGetConfigValue).toHaveBeenCalledWith("last_visit_at");
  });

  it("returns stored value when present", async () => {
    const storedTimestamp = "2026-04-10T12:00:00.000Z";
    mockedGetConfigValue.mockResolvedValueOnce(storedTimestamp);

    const { result } = renderHook(() => useLastVisitAt());

    await act(async () => {});

    expect(result.current.lastVisitAt).toBe(storedTimestamp);
    expect(mockedGetConfigValue).toHaveBeenCalledWith("last_visit_at");
  });

  it("updateLastVisitAt calls setConfigValue with ISO timestamp and updates state", async () => {
    const storedTimestamp = "2026-04-10T12:00:00.000Z";
    mockedGetConfigValue.mockResolvedValueOnce(storedTimestamp);
    mockedSetConfigValue.mockResolvedValueOnce(undefined);

    const fakeNow = "2026-04-13T15:30:00.000Z";
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(fakeNow);

    const { result } = renderHook(() => useLastVisitAt());
    await act(async () => {});

    expect(result.current.lastVisitAt).toBe(storedTimestamp);

    await act(async () => {
      await result.current.updateLastVisitAt();
    });

    expect(mockedSetConfigValue).toHaveBeenCalledWith("last_visit_at", fakeNow);
    expect(result.current.lastVisitAt).toBe(fakeNow);
  });
});
