import { create } from "zustand";

interface ShortcutsState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Open/close state for the keyboard shortcuts cheat-sheet dialog.
 *
 * Lives in its own store (separate from useViewStore) so the ⌘? keyboard
 * binding and any future help-menu trigger share one canonical source, and
 * so the cheat sheet can be mounted once at the shell and stay independent
 * of new-issue / search / Ask-AI dialog state.
 */
export const useShortcutsStore = create<ShortcutsState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}));
