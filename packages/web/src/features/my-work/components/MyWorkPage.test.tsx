import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { IssueListItem, IssueRelation, MyWorkResponse } from "@reef/core";
import type { MyWorkWorkspaceContext } from "@/features/my-work/lib/myWork";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUseActiveVault,
  mockUseMyWorkData,
  mockUseSearchParams,
  mockReplace,
} = vi.hoisted(() => ({
  mockUseActiveVault: vi.fn(),
  mockUseMyWorkData: vi.fn(),
  mockUseSearchParams: vi.fn(),
  mockReplace: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
}));
vi.mock("@/features/my-work/hooks/useMyWorkData", () => ({
  useMyWorkData: mockUseMyWorkData,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: mockUseSearchParams,
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
}));
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

const MOCK_NOW_MS = new Date("2026-06-18T00:00:00.000Z").getTime();
const base = { created_by: "alice", updated_by: "alice" };

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

function workspaceContext(
  workspace: string,
  issues: readonly IssueListItem[] = [],
  done = 0,
): MyWorkWorkspaceContext {
  return {
    workspace,
    assigned_issue_count: issues.length + done,
    resolved_sprint_counts:
      done > 0 ? [{ sprint_id: `sprint-${workspace}`, count: done }] : [],
    relations: issues.map(
      (issue): IssueRelation => ({
        id: issue.id,
        status: issue.status,
        depends_on: issue.depends_on ?? [],
        issue_type: issue.issue_type ?? "task",
        parent_id: issue.parent_id ?? null,
        title: issue.title,
        rank: issue.rank ?? null,
      }),
    ),
    planning: {
      sprints: [],
      milestones: [],
      releases: [],
      rollover_resumes: [],
    },
  };
}

function result(
  issues: Array<{ workspace: string; issue: IssueListItem }> = [],
  options: {
    assigned?: Record<string, number>;
    pending?: boolean;
    error?: boolean;
    login?: string | null;
    contexts?: MyWorkWorkspaceContext[];
  } = {},
) {
  const workspaces = Object.entries(options.assigned ?? {}).map(
    ([workspace, assigned_issue_count]) => ({
      workspace,
      assigned_issue_count,
      resolved_sprint_counts: [],
    }),
  );
  const data: MyWorkResponse = {
    issues,
    workspaces,
    next_offset: null,
    as_of: new Date(MOCK_NOW_MS).toISOString(),
  };
  return {
    data,
    workspaceContexts: options.contexts ?? [],
    isPending: options.pending ?? false,
    isError: options.error ?? false,
    error: options.error ? new Error("Could not load My Work") : null,
    refetch: vi.fn(),
    login: options.login === undefined ? "alice" : options.login,
    identityPending: false,
  };
}

describe("MyWorkPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(MOCK_NOW_MS);
    mockUseActiveVault.mockReturnValue({ vault: "reef-e2e", isLoading: false });
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    mockUseMyWorkData.mockReturnValue(
      result([], { assigned: { "reef-e2e": 0 } }),
    );
  });

  it("shows assigned issues from more than one workspace in the same list", () => {
    const alpha = makeIssue({ id: "REEF-001", title: "Alpha copy" });
    const zeta = makeIssue({ id: "REEF-001", title: "Zeta copy" });
    mockUseMyWorkData.mockReturnValue(
      result(
        [
          { workspace: "reef-alpha", issue: alpha },
          { workspace: "reef-zeta", issue: zeta },
        ],
        {
          assigned: { "reef-alpha": 1, "reef-e2e": 0, "reef-zeta": 1 },
          contexts: [
            workspaceContext("reef-alpha", [alpha]),
            workspaceContext("reef-zeta", [zeta]),
          ],
        },
      ),
    );

    render(
      <IntlTestProvider>
        <MyWorkPage />
      </IntlTestProvider>,
    );

    expect(
      screen.getByTestId("my-work-row-reef-alpha-REEF-001"),
    ).toHaveAttribute("href", "/workspace/reef-alpha/issues/REEF-001");
    expect(
      screen.getByTestId("my-work-row-reef-zeta-REEF-001"),
    ).toHaveAttribute("href", "/workspace/reef-zeta/issues/REEF-001");
    expect(
      within(screen.getByTestId("my-work-workspace-filter")).getByRole(
        "option",
        { name: "reef-alpha" },
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("my-work-workspace-filter")).getByRole(
        "option",
        { name: "reef-zeta" },
      ),
    ).toBeInTheDocument();
  });

  it("shows the shared pick-workspace notice when no workspace is active", () => {
    mockUseActiveVault.mockReturnValue({ vault: "", isLoading: false });
    render(
      <IntlTestProvider>
        <MyWorkPage />
      </IntlTestProvider>,
    );
    expect(screen.getByTestId("empty-workspace-notice")).toBeInTheDocument();
  });

  it("shows the no-session notice when logged out", () => {
    mockUseMyWorkData.mockReturnValue(
      result([], { assigned: { "reef-e2e": 0 }, login: null }),
    );
    render(
      <IntlTestProvider>
        <MyWorkPage />
      </IntlTestProvider>,
    );
    expect(screen.getByTestId("my-work-no-session")).toBeInTheDocument();
  });

  it("shows a passive empty state when no non-archived work is assigned", () => {
    render(
      <IntlTestProvider>
        <MyWorkPage />
      </IntlTestProvider>,
    );
    const notice = screen.getByTestId("my-work-empty");
    expect(notice).toBeInTheDocument();
    expect(within(notice).queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a passive caught-up state when assigned work is resolved", () => {
    mockUseMyWorkData.mockReturnValue(
      result([], { assigned: { "reef-e2e": 1 } }),
    );
    render(
      <IntlTestProvider>
        <MyWorkPage />
      </IntlTestProvider>,
    );
    const notice = screen.getByTestId("my-work-caught-up");
    expect(notice).toBeInTheDocument();
    expect(within(notice).queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a skeleton while the identity or query resolves", () => {
    mockUseMyWorkData.mockReturnValue(
      result([], { assigned: { "reef-e2e": 0 }, pending: true }),
    );
    render(
      <IntlTestProvider>
        <MyWorkPage />
      </IntlTestProvider>,
    );
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
      }),
      makeIssue({
        id: "REEF-2",
        status: "in_review",
        priority: "medium",
        due_date: iso(2),
      }),
      makeIssue({ id: "REEF-3", status: "todo", priority: "high" }),
      makeIssue({ id: "REEF-4", status: "backlog", priority: "low" }),
    ];

    beforeEach(() => {
      mockUseMyWorkData.mockReturnValue(
        result(
          issues.map((issue) => ({ workspace: "reef-alpha", issue })),
          {
            assigned: { "reef-alpha": issues.length },
            contexts: [workspaceContext("reef-alpha", issues)],
          },
        ),
      );
    });

    it("renders the global summary and focus-ordered queue", () => {
      render(
        <IntlTestProvider>
          <MyWorkPage />
        </IntlTestProvider>,
      );
      expect(screen.getByTestId("my-work-summary")).toBeInTheDocument();
      expect(screen.getByTestId("my-work-tile-wip")).toHaveTextContent("1");
      expect(screen.getByTestId("my-work-tile-overdue")).toHaveTextContent("1");
      expect(screen.getByTestId("my-work-tile-due-soon")).toHaveTextContent(
        "1",
      );
      const order = screen
        .getAllByTestId(/^my-work-row-/)
        .map((el) => el.getAttribute("data-testid"));
      expect(order[0]).toBe("my-work-row-reef-alpha-REEF-1");

      const firstRow = screen.getByTestId("my-work-row-reef-alpha-REEF-1");
      expect(
        within(firstRow).getByTestId("my-work-row-identity"),
      ).toBeInTheDocument();
      expect(within(firstRow).getByTestId("my-work-row-title")).toHaveAttribute(
        "title",
        "Issue REEF-1",
      );
      expect(
        within(firstRow).getByTestId("my-work-source-workspace"),
      ).toHaveTextContent("reef-alpha");
    });

    it("opens the source-workspace issue and preserves grouping query", () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams("group=status"));
      render(
        <IntlTestProvider>
          <MyWorkPage />
        </IntlTestProvider>,
      );
      expect(
        screen.getByTestId("my-work-row-reef-alpha-REEF-1"),
      ).toHaveAttribute(
        "href",
        "/workspace/reef-alpha/issues/REEF-1?group=status",
      );
    });

    it("preserves the workspace filter while changing queue grouping", () => {
      mockUseSearchParams.mockReturnValue(
        new URLSearchParams("workspace=reef-alpha"),
      );
      render(
        <IntlTestProvider>
          <MyWorkPage />
        </IntlTestProvider>,
      );
      fireEvent.click(screen.getByTestId("my-work-group-status"));
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-e2e/my-work?workspace=reef-alpha&group=status",
        { scroll: false },
      );
    });

    it("changes only the personal workspace filter", () => {
      render(
        <IntlTestProvider>
          <MyWorkPage />
        </IntlTestProvider>,
      );
      fireEvent.change(screen.getByTestId("my-work-workspace-filter"), {
        target: { value: "reef-alpha" },
      });
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-e2e/my-work?workspace=reef-alpha",
        { scroll: false },
      );
    });
  });
});
