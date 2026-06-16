import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
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
      if (path.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues }), { status: 200 });
    });
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
  });

  it("requests /api/issues?vault={vault} and renders the rows", async () => {
    render(wrap(<IssueListTable vault="reef-acme" />));

    expect(await screen.findByText("First task")).toBeInTheDocument();
    expect(screen.getByText("Second task")).toBeInTheDocument();
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues?vault=reef-acme&sort_field=priority&sort_order=desc",
    );
  });

  it("navigates to the issue detail route when a row is clicked", async () => {
    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" />));

    await user.click(await screen.findByText("First task"));
    expect(mockPush).toHaveBeenCalledWith("/issues/REEF-1");
  });

  it("preserves the current ?view= and filters when opening an issue (REEF-222)", async () => {
    navigationState.searchParams = new URLSearchParams("view=list&status=todo");
    const user = userEvent.setup();
    render(wrap(<IssueListTable vault="reef-acme" />));

    await user.click(await screen.findByText("First task"));
    expect(mockPush).toHaveBeenCalledWith(
      "/issues/REEF-1?view=list&status=todo",
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

  it("shows the data-empty state when no issues match", async () => {
    mockApiFetch.mockImplementation(async (url) => {
      if (String(url).startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ issues: [] }), { status: 200 });
    });

    render(wrap(<IssueListTable vault="reef-acme" />));
    expect(
      await screen.findByText(/Your workspace is empty/i),
    ).toBeInTheDocument();
  });
});
