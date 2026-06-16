// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { useViewStore } from "./useViewStore";

describe("useViewStore", () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useViewStore.setState({
      sidebarCollapsed: false,
      newIssueDialogOpen: false,
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
  });

  it("closeNewIssueDialog flips newIssueDialogOpen to false", () => {
    useViewStore.getState().openNewIssueDialog();
    useViewStore.getState().closeNewIssueDialog();
    expect(useViewStore.getState().newIssueDialogOpen).toBe(false);
  });
});
