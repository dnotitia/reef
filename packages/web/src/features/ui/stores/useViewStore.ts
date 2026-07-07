import type { Priority } from "@reef/core";
import { create } from "zustand";

export interface NewIssueDialogContext {
  kind: "subIssue";
  parent: {
    id: string;
    title: string;
  };
  defaults: {
    priority: Priority | null;
    sprintId: string | null;
    milestoneId: string | null;
    labels: string[];
  };
}

interface ViewState {
  sidebarCollapsed: boolean;
  newIssueDialogOpen: boolean;
  newIssueDialogContext: NewIssueDialogContext | null;
  createWorkspaceDialogOpen: boolean;
  toggleSidebar: () => void;
  openNewIssueDialog: (context?: NewIssueDialogContext) => void;
  closeNewIssueDialog: () => void;
  openCreateWorkspaceDialog: () => void;
  closeCreateWorkspaceDialog: () => void;
}

/**
 * Zustand store for UI view state.
 *
 * Rules:
 *  - consistently use granular selectors: `useViewStore(state => state.sidebarCollapsed)`
 *  - does not subscribe to the whole store: `useViewStore()`
 *  - Zustand 5 uses module-level stores — no Provider needed.
 */
export const useViewStore = create<ViewState>((set) => ({
  sidebarCollapsed: false,
  newIssueDialogOpen: false,
  newIssueDialogContext: null,
  createWorkspaceDialogOpen: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  openNewIssueDialog: (context) =>
    set({ newIssueDialogOpen: true, newIssueDialogContext: context ?? null }),
  closeNewIssueDialog: () =>
    set({ newIssueDialogOpen: false, newIssueDialogContext: null }),
  // The "New workspace" entry point lives in the sidebar workspace switcher
  // (REEF-146) and in Settings' Active Workspace section (REEF-147); both flip
  // this single flag so the globally-mounted CreateWorkspaceDialog is the one
  // canonical source.
  openCreateWorkspaceDialog: () => set({ createWorkspaceDialogOpen: true }),
  closeCreateWorkspaceDialog: () => set({ createWorkspaceDialogOpen: false }),
}));
