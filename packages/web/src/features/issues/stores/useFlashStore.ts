import { DURATION_SLOW } from "@/lib/motionTokens";
import { create } from "zustand";

interface FlashState {
  /**
   * Id of the issue whose card/row should play the save-confirm flash, or
   * null. Single-slot: a newer save supersedes an older pending flash.
   */
  flashedIssueId: string | null;
  flashIssue: (id: string) => void;
  /** Clear if `id` still owns the slot, so a newer flash isn't dropped. */
  clearFlash: (id: string) => void;
}

// Auto-expire after the flash animation window. The timer lives in the
// store — not in a subscriber — so the flag clears even if the flashing
// card/row unmounts first (a filter hides it, the user routes away, or a
// mutation resolves after the board unmounts). That prevents a stale id from
// mis-firing a delayed flash on a later mount, including another vault with a
// matching issue id. reduced-motion users (no animationend) are covered too.
const FLASH_CLEAR_MS = DURATION_SLOW + 100;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Transient "this issue just saved" signal, shared by the Kanban card and the
 * list row so an optimistic edit reads as *landed* with a one-shot highlight
 * instead of leaning on a toast (REEF-121). Lives in the issues domain rather
 * than the board store because both views consume it.
 *
 * Rules:
 *  - Granular selectors just (cards/rows go through `useIssueFlash`).
 *  - does not subscribe to the whole store.
 */
export const useFlashStore = create<FlashState>((set, get) => ({
  flashedIssueId: null,
  flashIssue: (id) => {
    if (flashTimer) clearTimeout(flashTimer);
    set({ flashedIssueId: id });
    flashTimer = setTimeout(() => {
      flashTimer = null;
      if (get().flashedIssueId === id) set({ flashedIssueId: null });
    }, FLASH_CLEAR_MS);
  },
  clearFlash: (id) =>
    set((state) =>
      state.flashedIssueId === id ? { flashedIssueId: null } : state,
    ),
}));

/**
 * Subscribe a card/row to its save-confirm flash. Returns whether this issue is
 * currently flashing; expiry is owned by the store (see `flashIssue`), so the
 * subscriber reads the derived boolean and does not hold a timer.
 */
export function useIssueFlash(issueId: string): boolean {
  return useFlashStore((s) => s.flashedIssueId === issueId);
}
