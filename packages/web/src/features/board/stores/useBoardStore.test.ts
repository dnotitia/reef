// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { useBoardStore } from "./useBoardStore";

describe("useBoardStore", () => {
  afterEach(() => {
    // Reset store state between tests
    useBoardStore.setState({ activeIssueId: null });
  });

  it("has initial state of null", () => {
    const state = useBoardStore.getState();
    expect(state.activeIssueId).toBeNull();
  });

  it("setActiveIssueId sets the value", () => {
    const { setActiveIssueId } = useBoardStore.getState();
    setActiveIssueId("reef-001");
    expect(useBoardStore.getState().activeIssueId).toBe("reef-001");
  });

  it("setActiveIssueId(null) clears the value", () => {
    const { setActiveIssueId } = useBoardStore.getState();
    setActiveIssueId("reef-001");
    setActiveIssueId(null);
    expect(useBoardStore.getState().activeIssueId).toBeNull();
  });
});
