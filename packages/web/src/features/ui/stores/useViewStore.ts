import { create } from "zustand";

interface ViewState {
  sidebarCollapsed: boolean;
  newIssueDialogOpen: boolean;
  createWorkspaceDialogOpen: boolean;
  toggleSidebar: () => void;
  openNewIssueDialog: () => void;
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
  createWorkspaceDialogOpen: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  openNewIssueDialog: () => set({ newIssueDialogOpen: true }),
  closeNewIssueDialog: () => set({ newIssueDialogOpen: false }),
  // The "New workspace" entry point lives in the sidebar workspace switcher
  // (REEF-146) and in Settings' Active Workspace section (REEF-147); both flip
  // this single flag so the globally-mounted CreateWorkspaceDialog is the one
  // canonical source.
  openCreateWorkspaceDialog: () => set({ createWorkspaceDialogOpen: true }),
  closeCreateWorkspaceDialog: () => set({ createWorkspaceDialogOpen: false }),
}));
