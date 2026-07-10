// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useIssueSelectionStore } from "./useIssueSelectionStore";

describe("useIssueSelectionStore", () => {
  beforeEach(() => {
    useIssueSelectionStore.getState().setRunning(false);
    useIssueSelectionStore.getState().clear();
  });

  it("toggles with immutable Set instances and replaces the anchor", () => {
    const before = useIssueSelectionStore.getState().selectedIds;
    useIssueSelectionStore.getState().toggle("A");
    const after = useIssueSelectionStore.getState();
    expect(after.selectedIds).not.toBe(before);
    expect([...after.selectedIds]).toEqual(["A"]);
    expect(after.anchor).toMatchObject({ issueId: "A" });
  });

  it("unions an inclusive range without replacing the modifier-free anchor", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("B");
    useIssueSelectionStore.getState().extendRange("D", ["A", "B", "C", "D"]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "B",
      "C",
      "D",
    ]);
    expect(useIssueSelectionStore.getState().anchor?.issueId).toBe("B");
  });

  it("clears the range anchor when the last selected issue is deselected", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("A");
    useIssueSelectionStore.getState().toggle("A");
    expect(useIssueSelectionStore.getState().anchor).toBeNull();

    useIssueSelectionStore.getState().extendRange("D", ["A", "B", "C", "D"]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual(["D"]);
    expect(useIssueSelectionStore.getState().anchor?.issueId).toBe("D");
  });

  it("toggles only loaded ids and removes successful items", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("outside");
    useIssueSelectionStore.getState().toggleAllLoaded(["A", "B"]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual([
      "outside",
      "A",
      "B",
    ]);
    useIssueSelectionStore.getState().removeSucceeded(["A", "outside"]);
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual(["B"]);
  });

  it("locks selection changes and clear requests while a job runs", () => {
    const store = useIssueSelectionStore.getState();
    store.toggle("A");
    useIssueSelectionStore.getState().setRunning(true);
    useIssueSelectionStore.getState().toggle("B");
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual(["A"]);
    useIssueSelectionStore.getState().clear();
    expect([...useIssueSelectionStore.getState().selectedIds]).toEqual(["A"]);
    expect(useIssueSelectionStore.getState()).toMatchObject({
      running: true,
    });

    useIssueSelectionStore.getState().setRunning(false);
    useIssueSelectionStore.getState().clear();
    expect(useIssueSelectionStore.getState().selectedIds.size).toBe(0);
  });
});
