// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "./useViewStore";

describe("useViewStore", () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useViewStore.setState({
      sidebarCollapsed: false,
      newIssueDialogOpen: false,
      newIssueDialogContext: null,
    });
  });

  it("initial state: sidebar is expanded", () => {
    const collapsed = useViewStore.getState().sidebarCollapsed;
    expect(collapsed).toBe(false);
  });

  it("toggleSidebar collapses when expanded", () => {
    useViewStore.getState().toggleSidebar();
    expect(useViewStore.getState().sidebarCollapsed).toBe(true);
  });

  it("toggleSidebar expands when collapsed", () => {
    useViewStore.setState({ sidebarCollapsed: true });
    useViewStore.getState().toggleSidebar();
    expect(useViewStore.getState().sidebarCollapsed).toBe(false);
  });

  it("toggleSidebar toggles multiple times correctly", () => {
    expect(useViewStore.getState().sidebarCollapsed).toBe(false);
    useViewStore.getState().toggleSidebar();
    expect(useViewStore.getState().sidebarCollapsed).toBe(true);
    useViewStore.getState().toggleSidebar();
    expect(useViewStore.getState().sidebarCollapsed).toBe(false);
  });

  it("granular selector: can select sidebarCollapsed without subscribing to whole store", () => {
    useViewStore.getState().toggleSidebar();
    // Granular selector pattern — does not useViewStore() with no args
    const collapsed = useViewStore.getState().sidebarCollapsed;
    expect(collapsed).toBe(true);
  });

  it("openNewIssueDialog flips newIssueDialogOpen to true", () => {
    expect(useViewStore.getState().newIssueDialogOpen).toBe(false);
    useViewStore.getState().openNewIssueDialog();
    expect(useViewStore.getState().newIssueDialogOpen).toBe(true);
    expect(useViewStore.getState().newIssueDialogContext).toBeNull();
  });

  it("openNewIssueDialog stores optional create context", () => {
    useViewStore.getState().openNewIssueDialog({
      kind: "subIssue",
      parent: { id: "REEF-1", title: "Parent issue" },
      defaults: {
        priority: "high",
        sprintId: "sprint-1",
        milestoneId: "m1",
        labels: ["ui"],
      },
    });

    expect(useViewStore.getState().newIssueDialogOpen).toBe(true);
    expect(useViewStore.getState().newIssueDialogContext).toEqual({
      kind: "subIssue",
      parent: { id: "REEF-1", title: "Parent issue" },
      defaults: {
        priority: "high",
        sprintId: "sprint-1",
        milestoneId: "m1",
        labels: ["ui"],
      },
    });
  });

  it("closeNewIssueDialog flips newIssueDialogOpen to false and clears context", () => {
    useViewStore.getState().openNewIssueDialog({
      kind: "subIssue",
      parent: { id: "REEF-1", title: "Parent issue" },
      defaults: {
        priority: null,
        sprintId: null,
        milestoneId: null,
        labels: [],
      },
    });
    useViewStore.getState().closeNewIssueDialog();
    expect(useViewStore.getState().newIssueDialogOpen).toBe(false);
    expect(useViewStore.getState().newIssueDialogContext).toBeNull();
  });
});
