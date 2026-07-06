"use client";

import { create } from "zustand";

export type IssueKeyboardScope = "list" | "board";
export type IssueQuickEditField = "status" | "assignee" | "priority" | "labels";

interface FocusRequest {
  scope: IssueKeyboardScope;
  issueId: string;
  serial: number;
}

interface QuickEditRequest extends FocusRequest {
  field: IssueQuickEditField;
}

type IssueIdsByScope = Record<IssueKeyboardScope, string[]>;
type FocusByScope = Record<IssueKeyboardScope, string | null>;

interface IssueKeyboardState {
  visibleIssueIds: IssueIdsByScope;
  focusedIssueId: FocusByScope;
  tabStopIssueId: FocusByScope;
  focusRequest: FocusRequest | null;
  quickEditRequest: QuickEditRequest | null;
  setVisibleIssueIds: (
    scope: IssueKeyboardScope,
    issueIds: readonly string[],
  ) => void;
  focusIssue: (
    scope: IssueKeyboardScope,
    issueId: string,
    options?: { requestDomFocus?: boolean },
  ) => void;
  moveFocus: (scope: IssueKeyboardScope, delta: 1 | -1) => void;
  requestQuickEdit: (
    scope: IssueKeyboardScope,
    field: IssueQuickEditField,
  ) => void;
  closeQuickEdit: () => void;
}

const EMPTY_IDS: IssueIdsByScope = { list: [], board: [] };
const EMPTY_FOCUS: FocusByScope = { list: null, board: null };

function dedupeIssueIds(issueIds: readonly string[]): string[] {
  return Array.from(new Set(issueIds));
}

export const useIssueKeyboardStore = create<IssueKeyboardState>((set) => ({
  visibleIssueIds: EMPTY_IDS,
  focusedIssueId: EMPTY_FOCUS,
  tabStopIssueId: EMPTY_FOCUS,
  focusRequest: null,
  quickEditRequest: null,

  setVisibleIssueIds: (scope, issueIds) =>
    set((state) => {
      const nextIds = dedupeIssueIds(issueIds);
      const currentFocus = state.focusedIssueId[scope];
      const currentTabStop = state.tabStopIssueId[scope];
      const nextFocus =
        currentFocus && nextIds.includes(currentFocus)
          ? currentFocus
          : nextIds.length > 0 && currentFocus
            ? nextIds[0]
            : null;
      const nextTabStop =
        currentTabStop && nextIds.includes(currentTabStop)
          ? currentTabStop
          : (nextFocus ?? nextIds[0] ?? null);

      return {
        visibleIssueIds: {
          ...state.visibleIssueIds,
          [scope]: nextIds,
        },
        focusedIssueId: {
          ...state.focusedIssueId,
          [scope]: nextFocus,
        },
        tabStopIssueId: {
          ...state.tabStopIssueId,
          [scope]: nextTabStop,
        },
        quickEditRequest:
          state.quickEditRequest?.scope === scope &&
          !nextIds.includes(state.quickEditRequest.issueId)
            ? null
            : state.quickEditRequest,
      };
    }),

  focusIssue: (scope, issueId, options = {}) =>
    set((state) => {
      const serial = (state.focusRequest?.serial ?? 0) + 1;
      return {
        focusedIssueId: { ...state.focusedIssueId, [scope]: issueId },
        tabStopIssueId: { ...state.tabStopIssueId, [scope]: issueId },
        focusRequest: options.requestDomFocus
          ? { scope, issueId, serial }
          : state.focusRequest,
      };
    }),

  moveFocus: (scope, delta) =>
    set((state) => {
      const ids = state.visibleIssueIds[scope];
      if (ids.length === 0) return {};

      const current =
        state.focusedIssueId[scope] ?? state.tabStopIssueId[scope];
      const currentIndex = current ? ids.indexOf(current) : -1;
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : ids.length - 1
          : state.focusedIssueId[scope]
            ? Math.max(0, Math.min(ids.length - 1, currentIndex + delta))
            : currentIndex;
      const issueId = ids[nextIndex];
      if (!issueId) return {};

      const serial = (state.focusRequest?.serial ?? 0) + 1;
      return {
        focusedIssueId: { ...state.focusedIssueId, [scope]: issueId },
        tabStopIssueId: { ...state.tabStopIssueId, [scope]: issueId },
        focusRequest: { scope, issueId, serial },
        quickEditRequest: null,
      };
    }),

  requestQuickEdit: (scope, field) =>
    set((state) => {
      const ids = state.visibleIssueIds[scope];
      const current =
        state.focusedIssueId[scope] ?? state.tabStopIssueId[scope];
      const issueId = current && ids.includes(current) ? current : ids[0];
      if (!issueId) return {};

      const focusSerial = (state.focusRequest?.serial ?? 0) + 1;
      const editSerial = (state.quickEditRequest?.serial ?? 0) + 1;
      return {
        focusedIssueId: { ...state.focusedIssueId, [scope]: issueId },
        tabStopIssueId: { ...state.tabStopIssueId, [scope]: issueId },
        focusRequest: { scope, issueId, serial: focusSerial },
        quickEditRequest: { scope, issueId, field, serial: editSerial },
      };
    }),

  closeQuickEdit: () => set({ quickEditRequest: null }),
}));
