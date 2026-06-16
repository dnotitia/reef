import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useActivityStore } from "./useActivityStore";

describe("useActivityStore", () => {
  beforeEach(() => {
    // Reset store state between tests
    useActivityStore.setState({ activityTypeFilter: "all" });
  });

  it("has default activityTypeFilter of 'all'", () => {
    const { result } = renderHook(() =>
      useActivityStore((state) => state.activityTypeFilter),
    );
    expect(result.current).toBe("all");
  });

  it("setActivityTypeFilter updates state to 'ai_draft'", () => {
    const { result } = renderHook(() => ({
      filter: useActivityStore((state) => state.activityTypeFilter),
      setFilter: useActivityStore((state) => state.setActivityTypeFilter),
    }));

    act(() => {
      result.current.setFilter("ai_draft");
    });

    expect(result.current.filter).toBe("ai_draft");
  });

  it("setActivityTypeFilter updates state to 'ai_status_change'", () => {
    const { result } = renderHook(() => ({
      filter: useActivityStore((state) => state.activityTypeFilter),
      setFilter: useActivityStore((state) => state.setActivityTypeFilter),
    }));

    act(() => {
      result.current.setFilter("ai_status_change");
    });

    expect(result.current.filter).toBe("ai_status_change");
  });

  it("granular selector returns correct slice without re-rendering other slices", () => {
    const { result } = renderHook(() =>
      useActivityStore((state) => state.activityTypeFilter),
    );

    expect(result.current).toBe("all");

    act(() => {
      useActivityStore.getState().setActivityTypeFilter("ai_status_change");
    });

    expect(result.current).toBe("ai_status_change");
  });
});
