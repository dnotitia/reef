// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useIssueKeyboardStore } from "./useIssueKeyboardStore";

describe("useIssueKeyboardStore", () => {
  beforeEach(() => {
    useIssueKeyboardStore.setState({
      visibleIssueIds: { list: [], board: [], backlog: [] },
      visibleOccurrences: { list: [], board: [], backlog: [] },
      focusedIssueId: { list: null, board: null, backlog: null },
      focusedOccurrenceKey: { list: null, board: null, backlog: null },
      tabStopIssueId: { list: null, board: null, backlog: null },
      tabStopOccurrenceKey: { list: null, board: null, backlog: null },
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

  it("keeps backlog focus in its own visible-id projection", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleIssueIds("backlog", ["REEF-030", "REEF-031"]);

    useIssueKeyboardStore.getState().moveFocus("backlog", 1);

    expect(useIssueKeyboardStore.getState().focusedIssueId.backlog).toBe(
      "REEF-030",
    );
    expect(useIssueKeyboardStore.getState().focusedIssueId.list).toBeNull();
    expect(useIssueKeyboardStore.getState().focusedIssueId.board).toBeNull();
  });

  it("keeps list and board focus independent", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleIssueIds("list", ["REEF-001"]);
    store.setVisibleIssueIds("board", ["REEF-010"]);

    useIssueKeyboardStore.getState().moveFocus("board", 1);

    expect(useIssueKeyboardStore.getState().focusedIssueId).toEqual({
      list: null,
      board: "REEF-010",
      backlog: null,
    });
    expect(useIssueKeyboardStore.getState().tabStopIssueId).toEqual({
      list: "REEF-001",
      board: "REEF-010",
      backlog: null,
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

  it("moves through bucket+issue occurrences while keeping selection identity unique", () => {
    const store = useIssueKeyboardStore.getState();
    store.setVisibleOccurrences("list", [
      { key: "label:alpha:REEF-001", issueId: "REEF-001" },
      { key: "label:beta:REEF-001", issueId: "REEF-001" },
      { key: "label:beta:REEF-002", issueId: "REEF-002" },
    ]);

    expect(useIssueKeyboardStore.getState().visibleIssueIds.list).toEqual([
      "REEF-001",
      "REEF-002",
    ]);
    useIssueKeyboardStore.getState().moveFocus("list", 1);
    expect(useIssueKeyboardStore.getState()).toMatchObject({
      focusedIssueId: { list: "REEF-001" },
      focusedOccurrenceKey: { list: "label:alpha:REEF-001" },
    });
    useIssueKeyboardStore.getState().moveFocus("list", 1);
    expect(useIssueKeyboardStore.getState().focusedOccurrenceKey.list).toBe(
      "label:beta:REEF-001",
    );
    useIssueKeyboardStore.getState().moveFocus("list", 1);
    expect(useIssueKeyboardStore.getState().focusedOccurrenceKey.list).toBe(
      "label:beta:REEF-002",
    );
  });

  it("keeps the focused occurrence for quick edit while mutation identity stays issue-scoped", () => {
    useIssueKeyboardStore.getState().setVisibleOccurrences("list", [
      { key: "label:frontend:REEF-001", issueId: "REEF-001" },
      { key: "label:e2e:REEF-001", issueId: "REEF-001" },
    ]);
    useIssueKeyboardStore
      .getState()
      .focusOccurrence("list", "label:e2e:REEF-001", "REEF-001");

    useIssueKeyboardStore.getState().requestQuickEdit("list", "labels");

    expect(useIssueKeyboardStore.getState().quickEditRequest).toMatchObject({
      issueId: "REEF-001",
      occurrenceKey: "label:e2e:REEF-001",
      field: "labels",
    });
    expect(useIssueKeyboardStore.getState().focusRequest).toMatchObject({
      issueId: "REEF-001",
      occurrenceKey: "label:e2e:REEF-001",
    });
  });
});
