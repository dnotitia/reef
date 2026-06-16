import { create } from "zustand";

interface GlobalSearchState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Open/close state for the global ⌘K search palette.
 *
 * Lives in a dedicated store (separate from useViewStore) so:
 *   - the keyboard shortcut, the future toolbar trigger, and any
 *     deep-link "open search with this prefilled query" callers share one
 *     canonical source;
 *   - the CommandDialog can be mounted once at the shell, controlled by
 *     this open flag, and stay independent of the new-issue dialog state.
 *
 * The current query text is kept inside the dialog component (transient
 * UI state, no need to persist or share globally).
 */
export const useGlobalSearchStore = create<GlobalSearchState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
