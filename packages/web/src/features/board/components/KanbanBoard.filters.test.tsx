import { useIssueKeyboardStore } from "@/features/issues/stores/useIssueKeyboardStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  FILTER_ISSUES,
  ISSUES,
  KanbanBoard,
  dndHarness,
  mockApiFetch,
  resetKanbanBoardMocks,
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
      "/api/issues?vault=reef-acme&sort_field=rank&sort_order=asc",
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

  it("sends the search query to the server as `q` (REEF-034)", async () => {
    // Free-text search is now a server predicate, not a client filter. The board
    // forwards `searchQuery` as `q=` and renders whatever the server returns —
    // the mock returns the already-narrowed result the server would.
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
    expect(requestedUrl).toContain("q=api");
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
    expect(
      within(frame).getByRole("heading", { name: "No matching issues" }),
    ).toBeInTheDocument();
    expect(
      within(frame).getByText(
        "Try widening your filters or search to see more issues.",
      ),
    ).toBeInTheDocument();
    expect(within(frame).queryByRole("button")).toBeNull();

    for (const name of ["Todo", "In Progress", "In Review", "Done", "Closed"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getAllByText("0", { exact: true })).toHaveLength(5);

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
