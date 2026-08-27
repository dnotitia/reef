import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const { mockPush, navigationState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  navigationState: { searchParams: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  useSearchParams: () => navigationState.searchParams,
  useParams: () => ({ vault: "reef-acme" }),
}));

import { IssueListTable } from "./IssueListTable";

const mockApiFetch = vi.mocked(apiFetch);

const base = {
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
} satisfies Partial<IssueMetadata>;

const issues: IssueMetadata[] = [
  {
    ...base,
    id: "REEF-1",
    title: "First task",
    status: "todo",
    priority: "high",
  },
  {
    ...base,
    id: "REEF-2",
    title: "Second task",
    status: "done",
    priority: "low",
  },
];

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("IssueListTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.searchParams = new URLSearchParams();
    mockApiFetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.startsWith("/api/vaults/") && path.endsWith("/members")) {
        return new Response(JSON.stringify({ members: [] }), { status: 200 });
      }
      if (path.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (path.startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues }), { status: 200 });
    });
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
    useIssueSelectionStore.getState().clear();
  });

  it("uses the current full-roster display name for rows and assignee groups", async () => {
    const assignedIssues: IssueMetadata[] = [
      { ...issues[0], title: "Assigned task", assigned_to: "alice" },
    ];
    mockApiFetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.startsWith("/api/vaults/") && path.endsWith("/members")) {
        return new Response(
          JSON.stringify({
            members: [
              {
                username: "alice",
                display_name: "  Alice Example  ",
                role: "reader",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (path.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (path.startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: assignedIssues }), {
        status: 200,
      });
    });

    render(wrap(<IssueListTable vault="reef-acme" groupBy="assignee" />));

    expect(await screen.findByText("Assigned task")).toBeInTheDocument();
    expect(screen.getAllByText("Alice Example")).toHaveLength(2);
    expect(screen.queryByText("alice")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Collapse Alice Example/ }),
    ).toBeInTheDocument();
  });

  it("preserves the server's canonical mixed-title order", async () => {
    const titleIssues: IssueMetadata[] = [
      { ...issues[1], id: "REEF-2", title: "! Symbol" },
      { ...issues[0], id: "REEF-1", title: "가나다" },
    ];
    useIssueStore.setState({
      filter: { sortField: "title", sortOrder: "asc" },
      searchQuery: "",
      selectedIssueId: null,
    });
    mockApiFetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.startsWith("/api/vaults/") && path.endsWith("/members")) {
        return new Response(JSON.stringify({ members: [] }), { status: 200 });
      }
      if (path.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (path.startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: titleIssues }), {
        status: 200,
      });
    });

    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("! Symbol");
    await screen.findByText("가나다");

    expect(
      screen
        .getAllByTestId("issue-list-row")
        .map((row) => row.getAttribute("data-issue-id")),
    ).toEqual(["REEF-2", "REEF-1"]);
  });

  it("falls back to stable logins and the existing dash for incomplete roster data", async () => {
    const fallbackIssues: IssueMetadata[] = [
      { ...issues[0], id: "REEF-1", title: "Blank name", assigned_to: "alice" },
      {
        ...issues[1],
        id: "REEF-2",
        title: "Unknown member",
        assigned_to: "missing-user",
      },
      { ...issues[0], id: "REEF-3", title: "Unassigned", assigned_to: null },
    ];
    mockApiFetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.startsWith("/api/vaults/") && path.endsWith("/members")) {
        return new Response(
          JSON.stringify({
            members: [
              { username: "alice", display_name: "   ", role: "reader" },
            ],
          }),
          { status: 200 },
        );
      }
      if (path.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (path.startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: fallbackIssues }), {
        status: 200,
      });
    });

    render(wrap(<IssueListTable vault="reef-acme" />));

    await screen.findByText("Blank name");
    expect(screen.getAllByText("alice")).toHaveLength(1);
    expect(screen.getAllByText("missing-user")).toHaveLength(1);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("requests the first 100-issue page and renders the rows", async () => {
    render(wrap(<IssueListTable vault="reef-acme" />));

    expect(await screen.findByText("First task")).toBeInTheDocument();
    expect(screen.getByText("Second task")).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues?vault=reef-acme&limit=100&status=todo&status=in_progress&status=in_review&status=done&status=closed&sort_field=rank&sort_order=asc",
    );
  });

  it("navigates to the issue detail route when a row is clicked", async () => {
    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" />));

    await user.click(await screen.findByText("First task"));
    expect(mockPush).toHaveBeenCalledWith("/workspace/reef-acme/issues/REEF-1");
  });

  it("preserves the current ?view= and filters when opening an issue (REEF-222)", async () => {
    navigationState.searchParams = new URLSearchParams("view=list&status=todo");
    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" />));

    await user.click(await screen.findByText("First task"));
    expect(mockPush).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-1?view=list&status=todo",
    );
  });

  it("renders column headers as display-only labels, not sort triggers (REEF-175)", async () => {
    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("First task");

    // No click-to-sort affordance off the column headers: the header SortControl
    // is the single sort entry point across every view, so the list does not
    // offer a competing one.
    expect(screen.queryByTestId("sort-header-priority")).toBeNull();

    // Clicking a column header is a no-op for sort state.
    await user.click(screen.getByRole("columnheader", { name: "Priority" }));
    expect(useIssueStore.getState().filter.sortField).toBeUndefined();
    expect(useIssueStore.getState().filter.sortOrder).toBeUndefined();
  });

  it("starts with the compact List preset and exposes optional columns locally", async () => {
    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("First task");

    expect(
      screen
        .getAllByRole("columnheader")
        .map((header) => header.getAttribute("data-column-key")),
    ).toEqual([
      "select",
      "rank",
      "id",
      "type",
      "title",
      "status",
      "priority",
      "assignee",
      "due",
      "updated",
    ]);
    expect(screen.queryByRole("columnheader", { name: "Start" })).toBeNull();
    expect(
      screen.getByTestId("issue-list-columns-control"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")[0]).toHaveClass("h-8", "py-0");
    expect(screen.getAllByTestId("issue-list-row")[0]).toHaveClass("h-10");
  });

  it("adds and removes planning columns independently without changing the query", async () => {
    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("First task");

    await user.click(screen.getByTestId("issue-list-columns-control"));
    await user.click(screen.getByTestId("issue-list-column-start"));
    expect(screen.getByRole("columnheader", { name: "Start" })).toBeVisible();

    await user.click(screen.getByTestId("issue-list-columns-control"));
    await user.click(screen.getByTestId("issue-list-column-release"));
    expect(screen.getByRole("columnheader", { name: "Release" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Start" })).toBeVisible();

    await user.click(screen.getByTestId("issue-list-columns-control"));
    await user.click(screen.getByTestId("issue-list-column-start"));
    expect(screen.queryByRole("columnheader", { name: "Start" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Release" })).toBeVisible();
  });

  it("resets optional columns when the List surface is re-entered", async () => {
    const user = userEvent.setup();
    const first = render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("First task");
    await user.click(screen.getByTestId("issue-list-columns-control"));
    await user.click(screen.getByTestId("issue-list-column-start"));
    expect(screen.getByRole("columnheader", { name: "Start" })).toBeVisible();

    first.unmount();
    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("First task");
    expect(screen.queryByRole("columnheader", { name: "Start" })).toBeNull();
  });

  it("selects and clears only the currently loaded logical ids from the header", async () => {
    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" />));
    await screen.findByText("First task");
    const selectAll = screen.getByRole("checkbox", {
      name: "Select all loaded issues",
    });
    await user.click(selectAll);
    expect([...useIssueSelectionStore.getState().selectedIds].sort()).toEqual([
      "REEF-1",
      "REEF-2",
    ]);
    expect(selectAll).toBeChecked();
    await user.click(screen.getAllByTestId("issue-row-checkbox")[0]);
    expect(selectAll).toHaveAttribute("aria-checked", "mixed");
  });

  it("shows the data-empty state when no issues match", async () => {
    mockApiFetch.mockImplementation(async (url) => {
      if (
        String(url).startsWith("/api/vaults/") &&
        String(url).endsWith("/members")
      ) {
        return new Response(JSON.stringify({ members: [] }), { status: 200 });
      }
      if (String(url).startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (String(url).startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: [] }), { status: 200 });
    });

    render(wrap(<IssueListTable vault="reef-acme" />));
    expect(
      await screen.findByText(/Your workspace is empty/i),
    ).toBeInTheDocument();
  });

  it("shows the filtered empty state after loaded rows are exhausted", async () => {
    useIssueStore.setState({
      filter: { label: "missing-label" },
      searchQuery: "",
      selectedIssueId: null,
    });

    render(wrap(<IssueListTable vault="reef-acme" />));

    expect(
      await screen.findByText("No issues match your filters."),
    ).toBeInTheDocument();
  });

  it("renders grouped label occurrences, a None bucket, and collapses rows in the virtual model", async () => {
    const groupedIssues: IssueMetadata[] = [
      { ...issues[0], labels: ["Zebra", "alpha"] },
      { ...issues[1], title: "Second label task", labels: ["Zebra"] },
      {
        ...issues[0],
        id: "REEF-3",
        title: "Unlabeled task",
        labels: [],
      },
    ];
    mockApiFetch.mockImplementation(async (url) => {
      if (
        String(url).startsWith("/api/vaults/") &&
        String(url).endsWith("/members")
      ) {
        return new Response(JSON.stringify({ members: [] }), { status: 200 });
      }
      if (String(url).startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (String(url).startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: groupedIssues }), {
        status: 200,
      });
    });

    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" groupBy="label" />));

    expect(await screen.findByText("Second label task")).toBeInTheDocument();
    expect(screen.getByText("Unlabeled task")).toBeInTheDocument();
    expect(screen.getAllByTestId("issue-group-header")).toHaveLength(3);
    expect(screen.getByTestId("issue-ordering-hint")).toHaveTextContent(
      "Switch to ungrouped Manual order",
    );
    expect(
      screen
        .getAllByTestId("issue-list-row")
        .map((row) => row.getAttribute("data-occurrence-key")),
    ).toEqual([
      "label:alpha:REEF-1",
      "label:Zebra:REEF-2",
      "label:Zebra:REEF-1",
      "label:none:REEF-3",
    ]);

    const zebraHeader = screen.getByRole("button", {
      name: /Collapse Zebra/,
    });
    expect(zebraHeader).toHaveAttribute("aria-expanded", "true");
    await user.click(zebraHeader);
    expect(zebraHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Second label task")).toBeNull();
    expect(screen.getByText("First task")).toBeInTheDocument();
  });

  it("toggles a grouped header from native Enter and Space key activation", async () => {
    const user = userEvent.setup();
    const groupedIssues: IssueMetadata[] = [
      { ...issues[0], labels: ["alpha"] },
      { ...issues[1], labels: ["beta"] },
    ];
    mockApiFetch.mockImplementation(async (url) => {
      if (
        String(url).startsWith("/api/vaults/") &&
        String(url).endsWith("/members")
      ) {
        return new Response(JSON.stringify({ members: [] }), { status: 200 });
      }
      if (String(url).startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      if (String(url).startsWith("/api/issues/relations")) {
        return new Response(JSON.stringify({ relations: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: groupedIssues }), {
        status: 200,
      });
    });

    render(wrap(<IssueListTable vault="reef-acme" groupBy="label" />));

    const toggle = await screen.findByRole("button", {
      name: /Collapse alpha/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    toggle.focus();
    expect(toggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();

    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveFocus();
  });
});
