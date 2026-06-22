import type { IssueListItem } from "@reef/core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}));

vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: () => loginState.value,
}));

// The hook rides MyWorkPage's `useIssueList` cache; mock the query so the test
// drives the rows directly and asserts the derivation, not the fetch.
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: () => ({ data: issuesState.value }),
}));

const { loginState, issuesState } = vi.hoisted(() => ({
  loginState: { value: null as string | null },
  issuesState: { value: undefined as IssueListItem[] | undefined },
}));

import { useMyWorkAttention } from "./useMyWorkAttention";

const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const makeIssue = (
  overrides: Partial<IssueListItem> & { id: string },
): IssueListItem =>
  ({
    title: `Issue ${overrides.id}`,
    status: "todo",
    issue_type: "task",
    assigned_to: "ann",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  }) as IssueListItem;

describe("useMyWorkAttention", () => {
  beforeEach(() => {
    loginState.value = "ann";
    issuesState.value = undefined;
  });

  it("counts overdue + due-soon over the signed-in user's server-scoped rows", () => {
    // The server `assigned_to` facet is now an exact match (REEF-267), so the
    // rows it returns are already exactly this user's work — the hook counts them
    // directly with no client re-scope.
    issuesState.value = [
      makeIssue({ id: "A", status: "in_progress", due_date: iso(-DAY) }), // overdue
      makeIssue({ id: "B", status: "todo", due_date: iso(DAY) }), // due soon
      makeIssue({ id: "C", status: "todo", due_date: iso(30 * DAY) }), // far → none
      // Resolved work has no deadline state even when past due.
      makeIssue({ id: "E", status: "done", due_date: iso(-DAY) }),
    ];

    const { result } = renderHook(() => useMyWorkAttention());

    expect(result.current).toEqual({ attention: 2, overdue: 1, dueSoon: 1 });
  });

  it("returns zeros when logged out without reading any rows", () => {
    loginState.value = null;
    issuesState.value = [makeIssue({ id: "A", due_date: iso(-DAY) })];

    const { result } = renderHook(() => useMyWorkAttention());

    expect(result.current).toEqual({ attention: 0, overdue: 0, dueSoon: 0 });
  });

  it("ignores archived work", () => {
    issuesState.value = [
      makeIssue({ id: "A", due_date: iso(-DAY) }), // overdue, counts
      makeIssue({
        id: "B",
        due_date: iso(-DAY),
        archived_at: "2026-05-01T00:00:00.000Z",
      }),
    ];

    const { result } = renderHook(() => useMyWorkAttention());

    expect(result.current).toEqual({ attention: 1, overdue: 1, dueSoon: 0 });
  });
});
