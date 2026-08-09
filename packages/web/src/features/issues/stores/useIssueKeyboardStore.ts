"use client";

import { create } from "zustand";

export type IssueKeyboardScope = "list" | "board" | "backlog";
export type IssueQuickEditField = "status" | "assignee" | "priority" | "labels";

interface FocusRequest {
  scope: IssueKeyboardScope;
  issueId: string;
  occurrenceKey?: string;
  serial: number;
}

interface QuickEditRequest extends FocusRequest {
  field: IssueQuickEditField;
}

type IssueIdsByScope = Record<IssueKeyboardScope, string[]>;
type FocusByScope = Record<IssueKeyboardScope, string | null>;
export interface IssueKeyboardOccurrence {
  key: string;
  issueId: string;
}
type OccurrencesByScope = Record<IssueKeyboardScope, IssueKeyboardOccurrence[]>;
type OccurrenceKeyByScope = Record<IssueKeyboardScope, string | null>;

interface IssueKeyboardState {
  visibleIssueIds: IssueIdsByScope;
  visibleOccurrences: OccurrencesByScope;
  focusedIssueId: FocusByScope;
  focusedOccurrenceKey: OccurrenceKeyByScope;
  tabStopIssueId: FocusByScope;
  tabStopOccurrenceKey: OccurrenceKeyByScope;
  focusRequest: FocusRequest | null;
  quickEditRequest: QuickEditRequest | null;
  setVisibleIssueIds: (
    scope: IssueKeyboardScope,
    issueIds: readonly string[],
  ) => void;
  setVisibleOccurrences: (
    scope: IssueKeyboardScope,
    occurrences: readonly IssueKeyboardOccurrence[],
  ) => void;
  focusIssue: (
    scope: IssueKeyboardScope,
    issueId: string,
    options?: { requestDomFocus?: boolean },
  ) => void;
  focusOccurrence: (
    scope: IssueKeyboardScope,
    occurrenceKey: string,
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

const EMPTY_IDS: IssueIdsByScope = { list: [], board: [], backlog: [] };
const EMPTY_FOCUS: FocusByScope = { list: null, board: null, backlog: null };
const EMPTY_OCCURRENCES: OccurrencesByScope = {
  list: [],
  board: [],
  backlog: [],
};
const EMPTY_OCCURRENCE_KEYS: OccurrenceKeyByScope = {
  list: null,
  board: null,
  backlog: null,
};

function dedupeIssueIds(issueIds: readonly string[]): string[] {
  return Array.from(new Set(issueIds));
}

export const useIssueKeyboardStore = create<IssueKeyboardState>((set) => ({
  visibleIssueIds: EMPTY_IDS,
  visibleOccurrences: EMPTY_OCCURRENCES,
  focusedIssueId: EMPTY_FOCUS,
  focusedOccurrenceKey: EMPTY_OCCURRENCE_KEYS,
  tabStopIssueId: EMPTY_FOCUS,
  tabStopOccurrenceKey: EMPTY_OCCURRENCE_KEYS,
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
      const nextOccurrences = nextIds.map((issueId) => ({
        key: issueId,
        issueId,
      }));
      const nextFocusOccurrence = nextFocus
        ? (nextOccurrences.find(({ issueId }) => issueId === nextFocus)?.key ??
          null)
        : null;
      const nextTabStopOccurrence = nextTabStop
        ? (nextOccurrences.find(({ issueId }) => issueId === nextTabStop)
            ?.key ?? null)
        : null;

      return {
        visibleIssueIds: {
          ...state.visibleIssueIds,
          [scope]: nextIds,
        },
        visibleOccurrences: {
          ...state.visibleOccurrences,
          [scope]: nextOccurrences,
        },
        focusedIssueId: {
          ...state.focusedIssueId,
          [scope]: nextFocus,
        },
        focusedOccurrenceKey: {
          ...state.focusedOccurrenceKey,
          [scope]: nextFocusOccurrence,
        },
        tabStopIssueId: {
          ...state.tabStopIssueId,
          [scope]: nextTabStop,
        },
        tabStopOccurrenceKey: {
          ...state.tabStopOccurrenceKey,
          [scope]: nextTabStopOccurrence,
        },
        quickEditRequest:
          state.quickEditRequest?.scope === scope &&
          !nextIds.includes(state.quickEditRequest.issueId)
            ? null
            : state.quickEditRequest,
      };
    }),

  setVisibleOccurrences: (scope, occurrences) =>
    set((state) => {
      const nextOccurrences = Array.from(
        new Map(
          occurrences.map((occurrence) => [occurrence.key, occurrence]),
        ).values(),
      );
      const nextIds = dedupeIssueIds(
        nextOccurrences.map(({ issueId }) => issueId),
      );
      const currentFocusKey = state.focusedOccurrenceKey[scope];
      const currentFocusId = state.focusedIssueId[scope];
      const currentTabStopKey = state.tabStopOccurrenceKey[scope];
      const currentTabStopId = state.tabStopIssueId[scope];
      const nextFocusKey =
        (currentFocusKey &&
          nextOccurrences.some(({ key }) => key === currentFocusKey) &&
          currentFocusKey) ||
        (currentFocusId
          ? (nextOccurrences.find(({ issueId }) => issueId === currentFocusId)
              ?.key ?? (nextIds.length > 0 ? nextOccurrences[0]?.key : null))
          : null);
      const nextTabStopKey =
        (currentTabStopKey &&
          nextOccurrences.some(({ key }) => key === currentTabStopKey) &&
          currentTabStopKey) ||
        (currentTabStopId
          ? (nextOccurrences.find(({ issueId }) => issueId === currentTabStopId)
              ?.key ??
            nextFocusKey ??
            nextOccurrences[0]?.key ??
            null)
          : (nextFocusKey ?? nextOccurrences[0]?.key ?? null));
      const nextFocusId = nextFocusKey
        ? (nextOccurrences.find(({ key }) => key === nextFocusKey)?.issueId ??
          null)
        : null;
      const nextTabStopId = nextTabStopKey
        ? (nextOccurrences.find(({ key }) => key === nextTabStopKey)?.issueId ??
          null)
        : null;

      return {
        visibleIssueIds: { ...state.visibleIssueIds, [scope]: nextIds },
        visibleOccurrences: {
          ...state.visibleOccurrences,
          [scope]: nextOccurrences,
        },
        focusedIssueId: { ...state.focusedIssueId, [scope]: nextFocusId },
        focusedOccurrenceKey: {
          ...state.focusedOccurrenceKey,
          [scope]: nextFocusKey,
        },
        tabStopIssueId: { ...state.tabStopIssueId, [scope]: nextTabStopId },
        tabStopOccurrenceKey: {
          ...state.tabStopOccurrenceKey,
          [scope]: nextTabStopKey,
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
      const occurrenceKey =
        state.visibleOccurrences[scope].find(
          (occurrence) => occurrence.issueId === issueId,
        )?.key ?? issueId;
      return {
        focusedIssueId: { ...state.focusedIssueId, [scope]: issueId },
        focusedOccurrenceKey: {
          ...state.focusedOccurrenceKey,
          [scope]: occurrenceKey,
        },
        tabStopIssueId: { ...state.tabStopIssueId, [scope]: issueId },
        tabStopOccurrenceKey: {
          ...state.tabStopOccurrenceKey,
          [scope]: occurrenceKey,
        },
        focusRequest: options.requestDomFocus
          ? { scope, issueId, occurrenceKey, serial }
          : state.focusRequest,
      };
    }),

  focusOccurrence: (scope, occurrenceKey, issueId, options = {}) =>
    set((state) => {
      const serial = (state.focusRequest?.serial ?? 0) + 1;
      return {
        focusedIssueId: { ...state.focusedIssueId, [scope]: issueId },
        focusedOccurrenceKey: {
          ...state.focusedOccurrenceKey,
          [scope]: occurrenceKey,
        },
        tabStopIssueId: { ...state.tabStopIssueId, [scope]: issueId },
        tabStopOccurrenceKey: {
          ...state.tabStopOccurrenceKey,
          [scope]: occurrenceKey,
        },
        focusRequest: options.requestDomFocus
          ? { scope, issueId, occurrenceKey, serial }
          : state.focusRequest,
      };
    }),

  moveFocus: (scope, delta) =>
    set((state) => {
      const occurrences = state.visibleOccurrences[scope];
      if (occurrences.length === 0) return {};

      const current =
        state.focusedOccurrenceKey[scope] ??
        state.tabStopOccurrenceKey[scope] ??
        state.focusedIssueId[scope] ??
        state.tabStopIssueId[scope];
      const currentIndex = current
        ? occurrences.findIndex(
            ({ key, issueId }) => key === current || issueId === current,
          )
        : -1;
      const nextIndex =
        currentIndex < 0
          ? delta > 0
            ? 0
            : occurrences.length - 1
          : state.focusedIssueId[scope]
            ? Math.max(
                0,
                Math.min(occurrences.length - 1, currentIndex + delta),
              )
            : currentIndex;
      const occurrence = occurrences[nextIndex];
      if (!occurrence) return {};

      const serial = (state.focusRequest?.serial ?? 0) + 1;
      return {
        focusedIssueId: {
          ...state.focusedIssueId,
          [scope]: occurrence.issueId,
        },
        focusedOccurrenceKey: {
          ...state.focusedOccurrenceKey,
          [scope]: occurrence.key,
        },
        tabStopIssueId: {
          ...state.tabStopIssueId,
          [scope]: occurrence.issueId,
        },
        tabStopOccurrenceKey: {
          ...state.tabStopOccurrenceKey,
          [scope]: occurrence.key,
        },
        focusRequest: {
          scope,
          issueId: occurrence.issueId,
          occurrenceKey: occurrence.key,
          serial,
        },
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

      const occurrenceKey =
        state.visibleOccurrences[scope].find(
          (occurrence) =>
            occurrence.issueId === issueId &&
            (occurrence.key === state.focusedOccurrenceKey[scope] ||
              occurrence.key === state.tabStopOccurrenceKey[scope]),
        )?.key ??
        state.visibleOccurrences[scope].find(
          (occurrence) => occurrence.issueId === issueId,
        )?.key ??
        issueId;

      const focusSerial = (state.focusRequest?.serial ?? 0) + 1;
      const editSerial = (state.quickEditRequest?.serial ?? 0) + 1;
      return {
        focusedIssueId: { ...state.focusedIssueId, [scope]: issueId },
        focusedOccurrenceKey: {
          ...state.focusedOccurrenceKey,
          [scope]: occurrenceKey,
        },
        tabStopIssueId: { ...state.tabStopIssueId, [scope]: issueId },
        tabStopOccurrenceKey: {
          ...state.tabStopOccurrenceKey,
          [scope]: occurrenceKey,
        },
        focusRequest: {
          scope,
          issueId,
          occurrenceKey,
          serial: focusSerial,
        },
        quickEditRequest: {
          scope,
          issueId,
          occurrenceKey,
          field,
          serial: editSerial,
        },
      };
    }),

  closeQuickEdit: () => set({ quickEditRequest: null }),
}));
