"use client";

import { inclusiveSelectionRange } from "@/features/issues/lib/issueSelection";
import { create } from "zustand";

export type IssueSelectionScope = "list" | "board";

interface SelectionAnchor {
  scope: IssueSelectionScope;
  issueId: string;
  group?: string;
}

interface IssueSelectionState {
  scope: IssueSelectionScope | null;
  selectedIds: ReadonlySet<string>;
  anchor: SelectionAnchor | null;
  running: boolean;
  toggle: (scope: IssueSelectionScope, issueId: string, group?: string) => void;
  extendRange: (
    scope: IssueSelectionScope,
    issueId: string,
    orderedIds: readonly string[],
    group?: string,
  ) => void;
  toggleAllLoaded: (
    scope: IssueSelectionScope,
    loadedIds: readonly string[],
  ) => void;
  removeSucceeded: (issueIds: readonly string[]) => void;
  setRunning: (running: boolean) => void;
  clear: () => void;
}

const EMPTY_SELECTION = new Set<string>();

export const useIssueSelectionStore = create<IssueSelectionState>((set) => ({
  scope: null,
  selectedIds: EMPTY_SELECTION,
  anchor: null,
  running: false,

  toggle: (scope, issueId, group) =>
    set((state) => {
      if (state.running) return {};
      const next = new Set(state.scope === scope ? state.selectedIds : []);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return {
        scope: next.size > 0 ? scope : null,
        selectedIds: next,
        anchor: { scope, issueId, group },
      };
    }),

  extendRange: (scope, issueId, orderedIds, group) =>
    set((state) => {
      if (state.running) return {};
      const sameContext =
        state.scope === scope &&
        state.anchor?.scope === scope &&
        state.anchor.group === group;
      const next = new Set(state.scope === scope ? state.selectedIds : []);
      const range = sameContext
        ? inclusiveSelectionRange(
            orderedIds,
            state.anchor?.issueId ?? "",
            issueId,
          )
        : [issueId];
      for (const id of range) next.add(id);
      return {
        scope,
        selectedIds: next,
        anchor: sameContext ? state.anchor : { scope, issueId, group },
      };
    }),

  toggleAllLoaded: (scope, loadedIds) =>
    set((state) => {
      if (state.running) return {};
      const next = new Set(state.scope === scope ? state.selectedIds : []);
      const allSelected =
        loadedIds.length > 0 && loadedIds.every((id) => next.has(id));
      for (const id of loadedIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return {
        scope: next.size > 0 ? scope : null,
        selectedIds: next,
        anchor: null,
      };
    }),

  removeSucceeded: (issueIds) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      for (const id of issueIds) next.delete(id);
      return {
        scope: next.size > 0 ? state.scope : null,
        selectedIds: next,
        anchor:
          state.anchor && next.has(state.anchor.issueId) ? state.anchor : null,
      };
    }),

  setRunning: (running) => set({ running }),
  clear: () =>
    set({ scope: null, selectedIds: new Set(), anchor: null, running: false }),
}));
