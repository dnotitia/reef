import { create } from "zustand";

/**
 * In-memory drill trail for the issue detail sheet (REEF-270).
 *
 * Following a relationship link (parent breadcrumb, sub-issue) replaces the
 * sheet's content in place rather than pushing a new browser-history entry, so
 * the visible "stack" of issues a user drilled through lives here instead of in
 * `window.history`. That split is the whole point: it lets Close exit to the
 * list in one shot (pop the entire trail) while Back unwinds one issue at a
 * time, without the two getting tangled in the browser back-stack.
 *
 * Shape:
 *  - `trail` holds the issue ids drilled *from*, oldest first; the top
 *    (`trail.at(-1)`) is the immediately previous issue a single Back returns
 *    to. The currently-shown issue is NOT in `trail` — it is tracked separately
 *    as `currentId`.
 *  - `currentId` is the issue the trail expects to be on screen. It lets the
 *    sheet tell apart a drill/back this store drove (keep the trail) from any
 *    other navigation that landed on a detail route — a fresh open from the
 *    list, the ⌘K palette, a sidebar link (reconcile to depth 0). See
 *    `reconcile`.
 *
 * Module-level (Zustand 5, no Provider) so it survives the soft-nav remounts a
 * drill triggers, and deliberately NOT persisted: a hard refresh / deep link
 * starts a fresh trail at depth 0.
 */
interface IssueNavStackState {
  /** Issue ids drilled *from*, oldest first. Top = immediate previous issue. */
  trail: string[];
  /** Issue the trail currently expects on screen, or null before any open. */
  currentId: string | null;
  /**
   * Record a drill hop: push the issue we are leaving (`fromId`) onto the trail
   * and move `currentId` to the target. Called right before the `router.replace`
   * that swaps the sheet content.
   */
  drill: (fromId: string, toId: string) => void;
  /**
   * Pop one drill hop and return the issue to navigate back to (the former top),
   * or null when the trail is already empty. Moves `currentId` back with it.
   */
  back: () => string | null;
  /**
   * Reconcile the trail with an issue id that appeared on a detail route. When
   * it matches `currentId` the store drove the navigation (drill/back) — leave
   * the trail alone. Otherwise the route was reached some other way, so reset to
   * a depth-0 trail rooted at that id.
   */
  reconcile: (id: string) => void;
  /** Empty the trail entirely (Close / exit to the entry view). */
  clear: () => void;
}

export const useIssueNavStack = create<IssueNavStackState>((set, get) => ({
  trail: [],
  currentId: null,

  drill: (fromId, toId) =>
    set((state) => ({ trail: [...state.trail, fromId], currentId: toId })),

  back: () => {
    const { trail } = get();
    if (trail.length === 0) return null;
    const previous = trail[trail.length - 1] ?? null;
    set({ trail: trail.slice(0, -1), currentId: previous });
    return previous;
  },

  reconcile: (id) => {
    if (get().currentId === id) return;
    set({ trail: [], currentId: id });
  },

  clear: () => set({ trail: [], currentId: null }),
}));
