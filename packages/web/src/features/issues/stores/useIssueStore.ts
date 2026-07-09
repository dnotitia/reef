import type { UserSortField } from "@reef/core/fields";
import { create } from "zustand";

export interface IssueFilter {
  // Multi-select facets (REEF-031 / REEF-267): an empty selection is represented
  // as `undefined` (the field is dropped), not an empty array, so truthy
  // `?.length` checks and the persisted/URL projections stay consistent.
  // assignee/requester/sprint_id/release_id became multi-select in REEF-267;
  // milestone_id and reporter stay single scalars.
  status?: string[];
  issueType?: string[];
  priority?: string[];
  assignee?: string[];
  requester?: string[];
  reporter?: string;
  severity?: string[];
  sprint_id?: string[];
  milestone_id?: string;
  release_id?: string[];
  due?: ("overdue" | "due_soon")[];
  label?: string;
  /** Retired: Use top-level searchQuery instead */
  search?: string;
  // Derived from core `USER_SORT_FIELDS` (single source) so adding a sort field
  // in core does not silently leave this union behind.
  sortField?: UserSortField;
  sortOrder?: "asc" | "desc";
  dependencyFilter?: ("blocked" | "blocking")[];
  /**
   * Controls whether archived issues (`archived_at != null`) appear in the
   * board/list. Default false — archived items are out of the way unless
   * the user explicitly asks to see them.
   */
  showArchived?: boolean;
  /**
   * Controls whether resolved issues that have aged past their auto-hide window
   * (`isStaleResolved`) appear in the board/list. Default false — long-finished
   * work is tucked out of the active view unless the user asks to see it
   * (REEF-275). Orthogonal to `showArchived`: a manual archive and a stale
   * auto-hide are distinct reasons an issue leaves the default view.
   */
  showStale?: boolean;
}

interface IssueState {
  filter: IssueFilter;
  /**
   * The vault whose filter currently populates the store, or `null` when the
   * filter has not yet been scoped to a vault. Owned by `useIssueUrlSync`.
   *
   * The store is module-level and survives `/issues` unmounts, but the hook's
   * per-mount refs do not. Tracking the owning vault here (same lifetime as the
   * filter) lets the hook detect a vault/account switch that happened while the
   * workspace was unmounted — e.g. switching workspace in Settings or an
   * account re-login — and reset the stale filter so it does not leaks across
   * vaults (REEF-009).
   */
  filterVault: string | null;
  searchQuery: string;
  selectedIssueId: string | null;
  setFilter: (filter: Partial<IssueFilter>) => void;
  clearFilter: () => void;
  clearFiltersOnly: () => void;
  setSortField: (field: IssueFilter["sortField"]) => void;
  setSortOrder: (order: IssueFilter["sortOrder"]) => void;
  /**
   * Clear BOTH halves of the sort back to the pristine default in one update.
   * The single owner of "return to no explicit sort" — the SortControl reset and
   * its rank-order option both call this, so the reset logic is not
   * copy-pasted across surfaces (REEF-169). Clearing both halves matters: an
   * orphaned `sortOrder` still serializes to the URL (`order=…`) and IndexedDB
   * and violates the field-⟺-order invariant.
   */
  clearSort: () => void;
  setSearchQuery: (query: string) => void;
  setSelectedIssueId: (id: string | null) => void;
  /**
   * Wipe the filter, search, and vault scope. Used on an akb account switch so a
   * different account on the same browser does not inherits the previous account's
   * in-memory filter — the module-level store survives a soft account change, so
   * clearing IndexedDB alone is not enough (REEF-009).
   */
  resetFilterScope: () => void;
}

/**
 * Zustand store for issue UI state.
 *
 * Rules:
 *  - consistently use granular selectors: `useIssueStore(state => state.filter)`
 *  - does not subscribe to the whole store: `useIssueStore()`
 *  - Zustand 5 uses module-level stores — no Provider needed.
 */
export const useIssueStore = create<IssueState>((set) => ({
  filter: {},
  filterVault: null,
  searchQuery: "",
  selectedIssueId: null,

  setFilter: (partialFilter) =>
    set((state) => ({ filter: { ...state.filter, ...partialFilter } })),

  clearFilter: () => set({ filter: {}, searchQuery: "" }),

  /** Clears filter/dependency fields just — does NOT clear sort or search */
  clearFiltersOnly: () =>
    set((state) => ({
      filter: {
        sortField: state.filter.sortField,
        sortOrder: state.filter.sortOrder,
      },
    })),

  setSortField: (field) =>
    set((state) => ({ filter: { ...state.filter, sortField: field } })),

  setSortOrder: (order) =>
    set((state) => ({ filter: { ...state.filter, sortOrder: order } })),

  clearSort: () =>
    set((state) => ({
      filter: { ...state.filter, sortField: undefined, sortOrder: undefined },
    })),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSelectedIssueId: (id) => set({ selectedIssueId: id }),

  resetFilterScope: () =>
    set({ filter: {}, searchQuery: "", filterVault: null }),
}));
