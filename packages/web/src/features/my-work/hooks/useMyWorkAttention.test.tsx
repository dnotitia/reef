import type { IssueListItem, MyWorkResponse } from "@reef/core";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  login: "ann" as string | null,
  data: undefined as MyWorkResponse | undefined,
}));

vi.mock("@/features/my-work/hooks/useMyWorkData", () => ({
  useMyWorkResponse: () => ({ login: state.login, data: state.data }),
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
    created_by: "ann",
    updated_by: "ann",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  }) as IssueListItem;

function setIssues(issues: IssueListItem[]) {
  state.data = {
    workspaces: [],
    issues: issues.map((issue) => ({ workspace: "reef-alpha", issue })),
    next_offset: null,
    as_of: new Date().toISOString(),
  };
}

describe("useMyWorkAttention", () => {
  beforeEach(() => {
    state.login = "ann";
    state.data = undefined;
  });

  it("counts overdue and due-soon rows from the shared global response", () => {
    setIssues([
      makeIssue({ id: "A", status: "in_progress", due_date: iso(-DAY) }),
      makeIssue({ id: "B", status: "todo", due_date: iso(DAY) }),
      makeIssue({ id: "C", status: "todo", due_date: iso(30 * DAY) }),
      makeIssue({ id: "E", status: "done", due_date: iso(-DAY) }),
    ]);

    const { result } = renderHook(() => useMyWorkAttention());

    expect(result.current).toEqual({ attention: 2, overdue: 1, dueSoon: 1 });
  });

  it("returns zeros when logged out", () => {
    state.login = null;
    setIssues([makeIssue({ id: "A", due_date: iso(-DAY) })]);

    const { result } = renderHook(() => useMyWorkAttention());

    expect(result.current).toEqual({ attention: 0, overdue: 0, dueSoon: 0 });
  });

  it("ignores archived work", () => {
    setIssues([
      makeIssue({ id: "A", due_date: iso(-DAY) }),
      makeIssue({
        id: "B",
        due_date: iso(-DAY),
        archived_at: "2026-05-01T00:00:00.000Z",
      }),
    ]);

    const { result } = renderHook(() => useMyWorkAttention());

    expect(result.current).toEqual({ attention: 1, overdue: 1, dueSoon: 0 });
  });
});
