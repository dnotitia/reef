import type { IssueListItem } from "@reef/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseActiveVault,
  mockUseCurrentUser,
  mockUseIssueList,
  mockUseIssueRelations,
  mockUsePlanningCatalog,
  mockUseSearchParams,
  mockReplace,
} = vi.hoisted(() => ({
  mockUseActiveVault: vi.fn(),
  mockUseCurrentUser: vi.fn(),
  mockUseIssueList: vi.fn(),
  mockUseIssueRelations: vi.fn(),
  mockUsePlanningCatalog: vi.fn(),
  mockUseSearchParams: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
}));
vi.mock("@/features/auth/hooks/useCurrentUser", () => ({
  useCurrentUser: mockUseCurrentUser,
}));
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: mockUseIssueList,
}));
vi.mock("@/features/issues/hooks/queries/useIssueRelations", () => ({
  useIssueRelations: mockUseIssueRelations,
}));
vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: mockUsePlanningCatalog,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: mockUseSearchParams,
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));
// `data-next-link` marks anchors that came through Next `Link`; a raw `<a>`
// would not carry it, so the empty-state CTA assertions below fail if an
// internal nav link regresses to a full-reload anchor (REEF-262).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a data-next-link="true" href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { MyWorkPage } from "./MyWorkPage";

const base = { created_by: "alice", updated_by: "alice" };

// A fixed reference "now". Both the `Date.now` mock and the date-relative
// fixtures (overdue/due-soon) derive from this single constant, so the suite no
// longer silently depended on the real wall clock matching the mock: `iso()`
// fixtures are evaluated at module-collection time, before `beforeEach` installs
// the mock, so computing them from the real `Date.now()` made the overdue
// boundary drift by a day on any date other than the one the test was written.
const MOCK_NOW_MS = new Date("2026-06-18T00:00:00.000Z").getTime();
const makeIssue = (
  overrides: Partial<IssueListItem> & { id: string },
): IssueListItem =>
  ({
    ...base,
    title: `Issue ${overrides.id}`,
    status: "todo",
    issue_type: "task",
    assigned_to: "alice",
    created_at: "2026-04-01T00:00:00.000Z",
    updated_at: "2026-04-01T00:00:00.000Z",
    ...overrides,
  }) as IssueListItem;

function issueListResult(data: IssueListItem[] | undefined, extra = {}) {
  return {
    data,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  };
}

describe("MyWorkPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(MOCK_NOW_MS);
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
    });
    mockUseCurrentUser.mockReturnValue({
      data: { username: "alice" },
      isPending: false,
    });
    mockUseIssueRelations.mockReturnValue({ data: undefined });
    mockUsePlanningCatalog.mockReturnValue({ data: undefined });
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockUseIssueList.mockReturnValue(issueListResult([]));
  });

  it("scopes the fetch to the signed-in user — no manual picker (AC1)", () => {
    render(<MyWorkPage />);
    // The assignee facet is now a multi-select array (REEF-267); My Work sends a
    // one-element array and relies on the server's exact match. It also opts out
    // of placeholder reuse so an account switch never shows the previous login's
    // rows.
    expect(mockUseIssueList).toHaveBeenCalledWith(
      "reef-acme",
      expect.objectContaining({ assigned_to: ["alice"] }),
      { keepPreviousData: false },
    );
  });

  it("shows the shared pick-workspace notice when no vault is active (AC7)", () => {
    mockUseActiveVault.mockReturnValue({ vault: "", isLoading: false });
    render(<MyWorkPage />);
    expect(screen.getByTestId("empty-workspace-notice")).toBeInTheDocument();
  });

  it("shows the no-session notice when logged out (AC7)", () => {
    mockUseCurrentUser.mockReturnValue({ data: null, isPending: false });
    render(<MyWorkPage />);
    expect(screen.getByTestId("my-work-no-session")).toBeInTheDocument();
    // A logged-out visit should not fan out a whole-vault fetch (blank vault,
    // no query); placeholder reuse is opted out as for every My Work fetch.
    expect(mockUseIssueList).toHaveBeenCalledWith("", undefined, {
      keepPreviousData: false,
    });
  });

  it("shows the empty state with a client-side board link when nothing is assigned (AC7, REEF-262)", () => {
    mockUseIssueList.mockReturnValue(issueListResult([]));
    render(<MyWorkPage />);
    expect(screen.getByTestId("my-work-empty")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Go to the board/ });
    expect(cta).toHaveAttribute("href", "/issues?view=board");
    expect(cta).toHaveAttribute("data-next-link", "true");
  });

  it("shows 'all caught up' with a client-side board link when assigned work is all resolved (AC7, REEF-262)", () => {
    mockUseIssueList.mockReturnValue(
      issueListResult([makeIssue({ id: "REEF-1", status: "done" })]),
    );
    render(<MyWorkPage />);
    expect(screen.getByTestId("my-work-caught-up")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Go to the board/ });
    expect(cta).toHaveAttribute("href", "/issues?view=board");
    expect(cta).toHaveAttribute("data-next-link", "true");
  });

  it("renders a skeleton while identity/workspace resolve", () => {
    mockUseActiveVault.mockReturnValue({ vault: "", isLoading: true });
    render(<MyWorkPage />);
    expect(screen.getByTestId("my-work-skeleton")).toBeInTheDocument();
  });

  describe("with assigned work", () => {
    const iso = (days: number) =>
      new Date(MOCK_NOW_MS + days * 86_400_000).toISOString();
    const issues = [
      makeIssue({
        id: "REEF-1",
        status: "in_progress",
        priority: "high",
        due_date: iso(-1),
      }), // overdue
      makeIssue({
        id: "REEF-2",
        status: "in_review",
        priority: "medium",
        due_date: iso(2),
      }), // due soon
      makeIssue({ id: "REEF-3", status: "todo", priority: "high" }),
      makeIssue({ id: "REEF-4", status: "backlog", priority: "low" }),
    ];

    beforeEach(() => {
      mockUseIssueList.mockReturnValue(issueListResult(issues));
    });

    it("renders the summary strip and the focus-ordered queue (AC2-4, AC6)", () => {
      render(<MyWorkPage />);
      expect(screen.getByTestId("my-work-summary")).toBeInTheDocument();
      // WIP=1, overdue=1, due-soon=1 surfaced as tiles.
      expect(screen.getByTestId("my-work-tile-wip")).toHaveTextContent("1");
      expect(screen.getByTestId("my-work-tile-overdue")).toHaveTextContent("1");
      expect(screen.getByTestId("my-work-tile-due-soon")).toHaveTextContent(
        "1",
      );
      // Focus order: overdue first.
      const order = screen
        .getAllByTestId(/^my-work-row-/)
        .map((el) => el.getAttribute("data-testid"));
      expect(order[0]).toBe("my-work-row-REEF-1");
    });

    it("opens an issue via an href that carries the current query (REEF-222)", () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams("group=status"));
      render(<MyWorkPage />);
      const row = screen.getByTestId("my-work-row-REEF-1");
      expect(row).toHaveAttribute("href", "/issues/REEF-1?group=status");
    });

    it("groups by status and writes the mode to the URL", () => {
      render(<MyWorkPage />);
      fireEvent.click(screen.getByTestId("my-work-group-status"));
      expect(mockReplace).toHaveBeenCalledWith("/my-work?group=status", {
        scroll: false,
      });
    });
  });
});
