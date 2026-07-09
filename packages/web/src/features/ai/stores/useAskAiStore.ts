import { create } from "zustand";

/** The issue the chat is currently grounded on, when any. */
export interface AskAiIssueContext {
  reefId: string;
}

interface AskAiState {
  /** Whether the floating chat panel is open. */
  isOpen: boolean;
  /**
   * Number of messages the user has actually seen — synced when the panel
   * is open. Used by AskAiFab to compute an unread dot when new assistant
   * messages arrive while the panel is closed.
   */
  seenMessageCount: number;
  /**
   * The issue the chat should ground on (REEF-360). Set by the issue detail
   * "Ask AI about this issue" affordance and by opening the panel over an open
   * issue sheet; cleared when the user removes the context chip. When set, the
   * dialog sends `reefId` with each chat request so core prefetches the issue.
   */
  issueContext: AskAiIssueContext | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Mark all messages up to `count` as seen. Called when the panel opens. */
  markSeen: (count: number) => void;
  /** Set (or clear, with null) the grounded issue context. */
  setIssueContext: (reefId: string | null) => void;
  /** Open the panel grounded on a specific issue (the chrome affordance). */
  openWithIssue: (reefId: string) => void;
}

/**
 * Global state for the floating Ask AI panel.
 *
 * Open/close lives here so:
 *   - DashboardShell can mount the FAB + Sheet once globally
 *   - any feature (future quick-link, context menu) can trigger the panel
 *   - ⌘+Shift+A keyboard shortcut wires through a single canonical source
 *
 * Conversation messages themselves are owned by the Ask AI chat runtime inside
 * AskAiDialog — we deliberately do NOT mirror them here. Persisting chat
 * history across panel closes is a future concern.
 */
export const useAskAiStore = create<AskAiState>((set) => ({
  isOpen: false,
  seenMessageCount: 0,
  issueContext: null,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  markSeen: (count) => set({ seenMessageCount: count }),
  setIssueContext: (reefId) =>
    set({ issueContext: reefId ? { reefId } : null }),
  openWithIssue: (reefId) => set({ isOpen: true, issueContext: { reefId } }),
}));
