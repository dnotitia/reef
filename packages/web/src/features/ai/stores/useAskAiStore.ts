import { create } from "zustand";

interface AskAiState {
  /** Whether the floating chat panel is open. */
  isOpen: boolean;
  /**
   * Number of messages the user has actually seen — synced when the panel
   * is open. Used by AskAiFab to compute an unread dot when new assistant
   * messages arrive while the panel is closed.
   */
  seenMessageCount: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Mark all messages up to `count` as seen. Called when the panel opens. */
  markSeen: (count: number) => void;
}

/**
 * Global state for the floating Ask AI panel.
 *
 * Open/close lives here so:
 *   - DashboardShell can mount the FAB + Sheet once globally
 *   - any feature (future quick-link, context menu) can trigger the panel
 *   - ⌘+Shift+A keyboard shortcut wires through a single canonical source
 *
 * Conversation messages themselves are owned by useChat() inside AskAiDialog —
 * we deliberately do NOT mirror them here. Persisting chat history across
 * panel closes is a future concern.
 */
export const useAskAiStore = create<AskAiState>((set) => ({
  isOpen: false,
  seenMessageCount: 0,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  markSeen: (count) => set({ seenMessageCount: count }),
}));
