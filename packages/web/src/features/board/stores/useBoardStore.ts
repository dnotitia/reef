import { create } from "zustand";

interface BoardState {
  activeIssueId: string | null;
  setActiveIssueId: (id: string | null) => void;
}

/**
 * Zustand store for Kanban board drag state.
 *
 * Holds the id of the issue card currently being dragged (for DragOverlay).
 * Separate from useIssueStore — board drag state is a distinct UI concern.
 *
 * Rules:
 *  - consistently use granular selectors: `useBoardStore(state => state.activeIssueId)`
 *  - does not subscribe to the whole store: `useBoardStore()`
 */
export const useBoardStore = create<BoardState>((set) => ({
  activeIssueId: null,
  setActiveIssueId: (id) => set({ activeIssueId: id }),
}));
