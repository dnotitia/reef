// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useIssueKeyboardStore } from "./useIssueKeyboardStore";

describe("useIssueKeyboardStore", () => {
  beforeEach(() => {
    useIssueKeyboardStore.setState({
      visibleIssueIds: { list: [], board: [] },
      focusedIssueId: { list: null, board: null },
      tabStopIssueId: { list: null, board: null },
      focusRequest: null,
      quickEditRequest: null,
    });
  });

  it("seeds a tab stop without visually focusing the first visible issue", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleIssueIds("board", ["REEF-010", "REEF-011"]);

    expect(useIssueKeyboardStore.getState().focusedIssueId.board).toBeNull();
    expect(useIssueKeyboardStore.getState().tabStopIssueId.board).toBe(
      "REEF-010",
    );
  });

  it("moves focus through visible issue ids and clamps at the edges", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleIssueIds("list", ["REEF-001", "REEF-002"]);

    useIssueKeyboardStore.getState().moveFocus("list", 1);
    expect(useIssueKeyboardStore.getState().focusedIssueId.list).toBe(
      "REEF-001",
    );

    useIssueKeyboardStore.getState().moveFocus("list", 1);
    useIssueKeyboardStore.getState().moveFocus("list", 1);
    expect(useIssueKeyboardStore.getState().focusedIssueId.list).toBe(
      "REEF-002",
    );

    useIssueKeyboardStore.getState().moveFocus("list", -1);
    expect(useIssueKeyboardStore.getState().focusedIssueId.list).toBe(
      "REEF-001",
    );
  });

  it("keeps list and board focus independent", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleIssueIds("list", ["REEF-001"]);
    store.setVisibleIssueIds("board", ["REEF-010"]);

    useIssueKeyboardStore.getState().moveFocus("board", 1);

    expect(useIssueKeyboardStore.getState().focusedIssueId).toEqual({
      list: null,
      board: "REEF-010",
    });
    expect(useIssueKeyboardStore.getState().tabStopIssueId).toEqual({
      list: "REEF-001",
      board: "REEF-010",
    });
  });

  it("opens quick edit on the focused issue and requests DOM focus", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleIssueIds("board", ["REEF-010", "REEF-011"]);
    store.focusIssue("board", "REEF-011");

    useIssueKeyboardStore.getState().requestQuickEdit("board", "status");

    expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
      scope: "board",
      issueId: "REEF-011",
      field: "status",
    });
    expect(useIssueKeyboardStore.getState().focusRequest).toMatchObject({
      scope: "board",
      issueId: "REEF-011",
    });
  });

  it("falls back to the first visible issue when quick edit has no focus yet", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleIssueIds("list", ["REEF-001", "REEF-002"]);

    useIssueKeyboardStore.getState().requestQuickEdit("list", "priority");

    expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
      scope: "list",
      issueId: "REEF-001",
      field: "priority",
    });
  });
});
