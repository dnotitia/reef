import { DURATION_SLOW } from "@/lib/motionTokens";
import { create } from "zustand";

interface FlashState {
  /**
   * Composite vault/issue keys whose card/row should play the save-confirm
   * flash. A Set keeps simultaneous saves visible independently.
   */
  flashedIssueKeys: Set<string>;
  flashIssue: (vault: string, id: string) => void;
  /** Clear only this vault/issue key, so another flash is never dropped. */
  clearFlash: (vault: string, id: string) => void;
}

// Auto-expire after the flash animation window. The timer lives in the
// store — not in a subscriber — so the flag clears even if the flashing
// card/row unmounts first (a filter hides it, the user routes away, or a
// mutation resolves after the board unmounts). That prevents a stale id from
// mis-firing a delayed flash on a later mount, including another vault with a
// matching issue id. reduced-motion users (no animationend) are covered too.
const FLASH_CLEAR_MS = DURATION_SLOW + 100;
const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

function flashKey(vault: string, issueId: string): string {
  return `${vault}:${issueId}`;
}

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
export const useFlashStore = create<FlashState>((set) => ({
  flashedIssueKeys: new Set(),
  flashIssue: (vault, issueId) => {
    const key = flashKey(vault, issueId);
    const previousTimer = flashTimers.get(key);
    if (previousTimer) clearTimeout(previousTimer);
    set((state) => {
      const flashedIssueKeys = new Set(state.flashedIssueKeys);
      flashedIssueKeys.add(key);
      return { flashedIssueKeys };
    });
    const timer = setTimeout(() => {
      flashTimers.delete(key);
      set((state) => {
        if (!state.flashedIssueKeys.has(key)) return state;
        const flashedIssueKeys = new Set(state.flashedIssueKeys);
        flashedIssueKeys.delete(key);
        return { flashedIssueKeys };
      });
    }, FLASH_CLEAR_MS);
    flashTimers.set(key, timer);
  },
  clearFlash: (vault, issueId) => {
    const key = flashKey(vault, issueId);
    const timer = flashTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      flashTimers.delete(key);
    }
    set((state) => {
      if (!state.flashedIssueKeys.has(key)) return state;
      const flashedIssueKeys = new Set(state.flashedIssueKeys);
      flashedIssueKeys.delete(key);
      return { flashedIssueKeys };
    });
  },
}));

/**
 * Subscribe a card/row to its save-confirm flash. Returns whether this issue is
 * currently flashing; expiry is owned by the store (see `flashIssue`), so the
 * subscriber reads the derived boolean and does not hold a timer.
 */
export function useIssueFlash(vault: string, issueId: string): boolean {
  const key = flashKey(vault, issueId);
  return useFlashStore((s) => s.flashedIssueKeys.has(key));
}
