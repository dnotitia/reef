// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useIssueSelectionStore } from "./useIssueSelectionStore";

describe("useIssueSelectionStore", () => {
  beforeEach(() => useIssueSelectionStore.getState().clear());

  it("toggles with immutable Set instances and replaces the anchor", () => {
    const before = useIssueSelectionStore.getState().selectedIds;
    useIssueSelectionStore.getState().toggle("list", "A");
    const after = useIssueSelectionStore.getState();
    expect(after.selectedIds).not.toBe(before);
    expect([...after.selectedIds]).toEqual(["A"]);
    expect(after.anchor).toMatchObject({ issueId: "A", scope: "list" });
  });

  it("unions an inclusive range without replacing the modifier-free anchor", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("list", "B");
    useIssueSelectionStore
      .getState()
      .extendRange("list", "D", ["A", "B", "C", "D"]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "B",
      "C",
      "D",
    ]);
    expect(useIssueSelectionStore.getState().anchor?.issueId).toBe("B");
  });

  it("keeps board ranges inside the anchor column", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("board", "A", "todo");
    useIssueSelectionStore
      .getState()
      .extendRange("board", "D", ["C", "D"], "done");
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "A",
      "D",
    ]);
  });

  it("toggles only loaded ids and removes successful items", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("list", "outside");
    useIssueSelectionStore.getState().toggleAllLoaded("list", ["A", "B"]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "outside",
      "A",
      "B",
    ]);
    useIssueSelectionStore.getState().removeSucceeded(["A", "outside"]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual(["B"]);
  });

  it("locks selection changes while a job runs and clears context", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("list", "A");
    useIssueSelectionStore.getState().setRunning(true);
    useIssueSelectionStore.getState().toggle("list", "B");
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual(["A"]);
    useIssueSelectionStore.getState().clear();
    expect(useIssueSelectionStore.getState()).toMatchObject({
      scope: null,
      running: false,
    });
    expect(useIssueSelectionStore.getState().selectedIds.size).toBe(0);
  });
});
