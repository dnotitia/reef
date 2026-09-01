import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import type { IssueMetadata, IssueRelation } from "@reef/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FILTER_ISSUES,
  ISSUES,
  KanbanBoard,
  dndHarness,
  mockApiFetch,
  resetKanbanBoardMocks,
  routerPush,
  wrap,
} from "./KanbanBoard.testSupport";

function issueApiResponse(url: unknown, body: { issues: typeof ISSUES }) {
  const payload = String(url).startsWith("/api/issues/relations")
    ? { relations: [] }
    : body;
  return new Response(JSON.stringify(payload), { status: 200 });
}

describe("KanbanBoard filtering and rendering", () => {
  beforeEach(() => {
    resetKanbanBoardMocks();
  });

  it("requests /api/issues?vault={vault} on mount", async () => {
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));
    await screen.findByText("Open A");

    // The board's pristine order is the issue-wide rank order (REEF-393),
    // applied on the wire so server pagination and the client column order agree.
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues?vault=reef-acme&status=todo&status=in_progress&status=in_review&status=done&status=closed&sort_field=rank&sort_order=asc",
    );
  });

  it("groups issues into status columns", async () => {
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));
    expect(await screen.findByText("Open A")).toBeInTheDocument();
    expect(await screen.findByText("In progress B")).toBeInTheDocument();
  });

  it("renders flat read-only Epic columns with parent metadata and fallbacks", async () => {
    const epicIssues: IssueMetadata[] = [
      {
        ...ISSUES[0],
        id: "REEF-100",
        title: "Foundation Epic",
        status: "in_progress",
        issue_type: "epic",
        rank: 1,
      },
      {
        ...ISSUES[1],
        id: "REEF-101",
        title: "Empty Epic",
        status: "todo",
        issue_type: "epic",
        rank: 2,
      },
      {
        ...ISSUES[0],
        id: "REEF-001",
        title: "Completed foundation work",
        status: "done",
        issue_type: "story",
        parent_id: "REEF-100",
        rank: 3,
      },
      {
        ...ISSUES[1],
        id: "REEF-002",
        title: "Open foundation work",
        status: "todo",
        issue_type: "task",
        parent_id: "REEF-100",
        rank: 4,
      },
      {
        ...ISSUES[0],
        id: "REEF-003",
        title: "Independent work",
        status: "todo",
        issue_type: "task",
        rank: 5,
      },
      {
        ...ISSUES[1],
        id: "REEF-004",
        title: "Missing parent work",
        status: "todo",
        issue_type: "task",
        parent_id: "REEF-999",
        rank: 6,
      },
    ];
    const hierarchy: IssueRelation[] = epicIssues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      status: issue.status,
      issue_type: issue.issue_type ?? "task",
      parent_id: issue.parent_id ?? null,
      rank: issue.rank ?? null,
      depends_on: issue.depends_on ?? [],
    }));
    mockApiFetch.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/users/search")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (String(url).startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: hierarchy }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ issues: epicIssues }), {
        status: 200,
      });
    });

    render(wrap(<KanbanBoard vault="reef-acme" groupBy="epic" />));

    expect(
      await screen.findByText("Completed foundation work"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("epic-group-header")).toHaveLength(2);
    expect(screen.getByText("REEF-100")).toBeInTheDocument();
    expect(screen.getByText("Foundation Epic")).toBeInTheDocument();
    for (const header of screen.getAllByTestId("epic-group-header")) {
      expect(header).not.toHaveTextContent("In Progress");
      expect(header).not.toHaveTextContent("1 of 2 done or closed");
    }
    expect(screen.getByText("Empty Epic")).toBeInTheDocument();
    expect(screen.getByText("No epic")).toBeInTheDocument();
    expect(screen.getByText("Unavailable parent")).toBeInTheDocument();
    expect(screen.getAllByTestId("kanban-card")).toHaveLength(4);
    expect(
      screen.queryByText("Foundation Epic", { selector: "h4" }),
    ).toBeNull();
    expect(screen.queryByTestId("epic-group-read-only")).toBeNull();
    expect(document.querySelectorAll('[data-group-by="epic"]')).toHaveLength(4);
    expect(screen.getAllByTestId("epic-group-header")).toHaveLength(2);
    for (const column of document.querySelectorAll('[data-group-by="epic"]')) {
      expect(column).not.toHaveAttribute("aria-describedby");
    }
    for (const card of screen.getAllByTestId("kanban-card")) {
      expect(card).not.toHaveAttribute("aria-disabled");
      expect(card).not.toHaveAttribute(
        "title",
        "Epic groups are read-only. Change the parent from the issue details.",
      );
    }

    const user = userEvent.setup();
    const childCard = screen
      .getAllByTestId("kanban-card")
      .find((card) => card.textContent?.includes("Completed foundation work"));
    if (!childCard) throw new Error("Missing Epic child card");
    await user.click(childCard);
    expect(routerPush).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-001",
    );
    routerPush.mockClear();
    fireEvent.keyDown(childCard, { key: "Enter" });
    expect(routerPush).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-001",
    );
  });

  it("registers only rendered workflow cards for board keyboard focus", async () => {
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, {
        issues: [
          {
            id: "REEF-000",
            title: "Backlog hidden",
            status: "backlog",
            priority: "critical",
            created_at: "2026-05-01T00:00:00.000Z",
            created_by: "alice",
            updated_at: "2026-05-01T00:00:00.000Z",
            updated_by: "alice",
          },
          ISSUES[0],
        ],
      }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("Open A")).toBeInTheDocument();
    expect(screen.queryByText("Backlog hidden")).toBeNull();
    await waitFor(() => {
      expect(useIssueKeyboardStore.getState().visibleIssueIds.board).toEqual([
        "REEF-001",
      ]);
    });
    expect(useIssueKeyboardStore.getState().tabStopIssueId.board).toBe(
      "REEF-001",
    );
  });

  it("applies priority filters to board cards", async () => {
    useIssueStore.setState({
      filter: { priority: ["high"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: FILTER_ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("UI board polish")).toBeInTheDocument();
    expect(screen.queryByText("API cleanup")).toBeNull();
    expect(screen.queryByText("Backend blocker")).toBeNull();
  });

  it("applies unset metadata filters through the same board pipeline", async () => {
    useIssueStore.setState({
      filter: { priorityUnset: true, assigneeUnset: true },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, {
        issues: [
          FILTER_ISSUES[0],
          {
            ...FILTER_ISSUES[1],
            id: "REEF-014",
            title: "Unset metadata",
            priority: null,
            assigned_to: "   ",
          },
        ],
      }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("Unset metadata")).toBeInTheDocument();
    expect(screen.queryByText("UI board polish")).toBeNull();
  });

  it("applies status filters while keeping every status column visible", async () => {
    useIssueStore.setState({
      filter: { status: ["todo"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: FILTER_ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("UI board polish")).toBeInTheDocument();
    expect(screen.getByText("Backend blocker")).toBeInTheDocument();
    expect(screen.queryByText("API cleanup")).toBeNull();
    // `todo`'s column header reads "Todo" (REEF-109); `backlog` has no column.
    expect(screen.getByRole("heading", { name: "Todo" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "In Progress" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "In Review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Closed" })).toBeInTheDocument();
    // `backlog` is does not an active board column (REEF-109).
    expect(screen.queryByRole("heading", { name: "Backlog" })).toBeNull();
  });

  it("applies assignee and label filters to board cards", async () => {
    useIssueStore.setState({
      filter: { assignee: ["alice"], label: "ui" },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: FILTER_ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("UI board polish")).toBeInTheDocument();
    expect(screen.queryByText("API cleanup")).toBeNull();
    expect(screen.queryByText("Backend blocker")).toBeNull();
  });

  it("keeps the full rank spine while applying search locally for Manual order", async () => {
    useIssueStore.setState({
      filter: {},
      searchQuery: "api",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: [FILTER_ISSUES[1]] }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("API cleanup")).toBeInTheDocument();
    expect(screen.queryByText("UI board polish")).toBeNull();
    const requestedUrl = mockApiFetch.mock.calls[0]?.[0] as string;
    expect(requestedUrl).toContain("sort_field=rank");
    expect(requestedUrl).not.toContain("q=api");
  });

  it("applies dependency filters to board cards", async () => {
    useIssueStore.setState({
      filter: { dependencyFilter: ["blocked"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: FILTER_ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("UI board polish")).toBeInTheDocument();
    expect(screen.queryByText("API cleanup")).toBeNull();
    expect(screen.queryByText("Backend blocker")).toBeNull();
  });

  it("shows a no-match frame without replacing columns and clears the full filter", async () => {
    useIssueStore.setState({
      filter: {
        label: "missing-label",
        showArchived: true,
        sortField: "title",
        sortOrder: "desc",
      },
      searchQuery: "missing search",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: FILTER_ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    const frame = await screen.findByTestId("kanban-no-matches");
    const heading = within(frame).getByRole("heading", {
      name: "No matching issues",
    });
    const description = within(frame).getByText(
      "Try widening your filters or search to see more issues.",
    );
    expect(frame.tagName).toBe("SECTION");
    expect(frame).toHaveAccessibleName("No matching issues");
    expect(frame).toHaveAccessibleDescription(
      "Try widening your filters or search to see more issues.",
    );
    expect(frame).toHaveAttribute("aria-labelledby", heading.id);
    expect(frame).toHaveAttribute("aria-describedby", description.id);
    expect(heading).toBeInTheDocument();
    expect(description).toBeInTheDocument();
    expect(
      within(frame).queryByRole("button", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear filters" }),
    ).toBeInTheDocument();

    for (const name of ["Todo", "In Progress", "In Review", "Done", "Closed"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByText("0", { exact: true })).toHaveLength(5);
    expect(screen.getByTestId("dnd-context")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(useIssueStore.getState().filter).toEqual({});
    expect(useIssueStore.getState().searchQuery).toBe("");
    expect(await screen.findByText("UI board polish")).toBeInTheDocument();
    expect(screen.queryByTestId("kanban-no-matches")).toBeNull();
  });

  it("keeps true empty and sort-only boards as five empty columns", async () => {
    useIssueStore.setState({
      filter: { sortField: "title", sortOrder: "desc" },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: [] }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    await screen.findByRole("heading", { name: "Todo" });
    expect(screen.queryByTestId("kanban-no-matches")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
    expect(screen.getAllByText("0", { exact: true })).toHaveLength(5);

    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
    expect(screen.queryByTestId("kanban-no-matches")).toBeNull();
    expect(screen.getAllByText("0", { exact: true })).toHaveLength(5);
  });

  it("hides archived cards by default and shows them when requested", async () => {
    // A fresh Response per call: the board fetches both the list and the
    // relation projection, and changing the filter re-fetches under a new query
    // key — a single shared Response body would be consumed after the first read.
    mockApiFetch.mockImplementation(async (url) =>
      issueApiResponse(url, { issues: FILTER_ISSUES }),
    );

    render(wrap(<KanbanBoard vault="reef-acme" />));

    expect(await screen.findByText("UI board polish")).toBeInTheDocument();
    expect(screen.queryByText("Security review")).toBeNull();

    useIssueStore.setState({
      filter: { showArchived: true },
      searchQuery: "",
      selectedIssueId: null,
    });

    expect(await screen.findByText("Security review")).toBeInTheDocument();
  });
});
