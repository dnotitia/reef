import { create } from "zustand";

type ActivityTypeFilter =
  | "all"
  | "ai_draft"
  | "ai_status_change"
  | "issue_change";

interface ActivityState {
  activityTypeFilter: ActivityTypeFilter;
  setActivityTypeFilter: (filter: ActivityTypeFilter) => void;
}

/**
 * Zustand store for Activity Hub UI state.
 *
 * Rules:
 *  - consistently use granular selectors: `useActivityStore(state => state.activityTypeFilter)`
 *  - does not subscribe to the whole store: `useActivityStore()`
 *  - Zustand 5 uses module-level stores — no Provider needed.
 */
export const useActivityStore = create<ActivityState>((set) => ({
  activityTypeFilter: "all",
  setActivityTypeFilter: (filter) => set({ activityTypeFilter: filter }),
}));
