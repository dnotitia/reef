"use client";

import { inclusiveSelectionRange } from "@/features/issues/lib/issueSelection";
import { create } from "zustand";

interface SelectionAnchor {
  issueId: string;
}

interface IssueSelectionState {
  selectedIds: ReadonlySet<string>;
  anchor: SelectionAnchor | null;
  running: boolean;
  toggle: (issueId: string) => void;
  extendRange: (issueId: string, orderedIds: readonly string[]) => void;
  toggleAllLoaded: (loadedIds: readonly string[]) => void;
  removeSucceeded: (issueIds: readonly string[]) => void;
  setRunning: (running: boolean) => void;
  clear: () => void;
  clearForContextChange: () => void;
}

const EMPTY_SELECTION = new Set<string>();

export const useIssueSelectionStore = create<IssueSelectionState>((set) => ({
  selectedIds: EMPTY_SELECTION,
  anchor: null,
  running: false,

  toggle: (issueId) =>
    set((state) => {
      if (state.running) return {};
      const next = new Set(state.selectedIds);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return {
        selectedIds: next,
        anchor: next.size === 0 ? null : { issueId },
      };
    }),

  extendRange: (issueId, orderedIds) =>
    set((state) => {
      if (state.running) return {};
      const next = new Set(state.selectedIds);
      const range = state.anchor
        ? inclusiveSelectionRange(orderedIds, state.anchor.issueId, issueId)
        : [issueId];
      for (const id of range) next.add(id);
      return {
        selectedIds: next,
        anchor: state.anchor ?? { issueId },
      };
    }),

  toggleAllLoaded: (loadedIds) =>
    set((state) => {
      if (state.running) return {};
      const next = new Set(state.selectedIds);
      const allSelected =
        loadedIds.length > 0 && loadedIds.every((id) => next.has(id));
      for (const id of loadedIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return {
        selectedIds: next,
        anchor: null,
      };
    }),

  removeSucceeded: (issueIds) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      for (const id of issueIds) next.delete(id);
      return {
        selectedIds: next,
        anchor:
          state.anchor && next.has(state.anchor.issueId) ? state.anchor : null,
      };
    }),

  setRunning: (running) => set({ running }),
  clear: () =>
    set((state) =>
      state.running ? {} : { selectedIds: new Set(), anchor: null },
    ),
  clearForContextChange: () => set({ selectedIds: new Set(), anchor: null }),
}));
