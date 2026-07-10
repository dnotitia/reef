// fake-indexeddb/auto should be imported first — IssuesWorkspace now restores and
// persists the issue filter through the Dexie config store (REEF-009).
import "fake-indexeddb/auto";

import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import {
  getPersistedIssueFilter,
  setPersistedIssueFilter,
} from "@/lib/storage/config";
import { db } from "@/lib/storage/db";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, mockReplace, mockUseActiveVault, navigationState } =
  vi.hoisted(() => ({
    mockPush: vi.fn(),
    mockReplace: vi.fn(),
    mockUseActiveVault: vi.fn(),
    navigationState: {
      pathname: "/workspace/reef-acme/issues",
      searchParams: new URLSearchParams(),
    },
  }));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: vi.fn() }),
  usePathname: () => navigationState.pathname,
  useSearchParams: () => navigationState.searchParams,
}));

// Mock the heavy body components and the filter toolbar so the test focuses
// on the workspace's view-switching and chrome wiring.
vi.mock("@/features/board/components/KanbanBoard", () => ({
  KanbanBoard: ({ vault }: { vault: string }) => (
    <div data-testid="board-body" data-vault={vault} />
  ),
}));
vi.mock("@/features/issues/components/list/IssueListTable", () => ({
  IssueListTable: ({ vault }: { vault: string }) => (
    <div data-testid="list-body" data-vault={vault} />
  ),
}));
vi.mock("@/features/issues/components/bulk/BoardBulkEditShortcut", () => ({
  BoardBulkEditShortcut: () => <div data-testid="board-bulk-edit-shortcut" />,
}));
vi.mock("@/features/issues/components/bulk/IssueBulkActionBar", () => ({
  IssueBulkActionBar: () => <div data-testid="issue-bulk-action-bar" />,
}));
vi.mock("@/features/timeline/components/TimelineBody", () => ({
  TimelineBody: ({ vault }: { vault: string }) => (
    <div data-testid="timeline-body" data-vault={vault} />
  ),
}));
vi.mock("@/features/issues/components/filters/IssueFilterToolbar", () => ({
  IssueFilterToolbar: () => <div data-testid="filter-toolbar" />,
}));

import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { IssuesWorkspace } from "./IssuesWorkspace";

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>
  );
}

describe("IssuesWorkspace", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    navigationState.pathname = "/workspace/reef-acme/issues";
    navigationState.searchParams = new URLSearchParams();
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    useIssueStore.setState({
      filter: {},
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
    });
    await db.config.clear();
  });

  it("defaults to the board view when no ?view= is present", () => {
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("board-body")).toBeInTheDocument();
    expect(screen.getByTestId("board-bulk-edit-shortcut")).toBeInTheDocument();
    expect(screen.queryByTestId("issue-bulk-action-bar")).toBeNull();
    expect(screen.queryByTestId("list-body")).toBeNull();
    expect(screen.queryByTestId("timeline-body")).toBeNull();
  });

  it("renders the list body when ?view=list", () => {
    navigationState.searchParams = new URLSearchParams("view=list");
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("list-body")).toBeInTheDocument();
    expect(screen.getByTestId("issue-bulk-action-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("board-bulk-edit-shortcut")).toBeNull();
    expect(screen.queryByTestId("board-body")).toBeNull();
  });

  it("renders the timeline body when ?view=timeline", () => {
    navigationState.searchParams = new URLSearchParams("view=timeline");
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("timeline-body")).toBeInTheDocument();
  });

  it("falls back to the board view for an unrecognized ?view=", () => {
    navigationState.searchParams = new URLSearchParams("view=bogus");
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("board-body")).toBeInTheDocument();
  });

  it("shows the shared pick-workspace empty state and no toolbar/body when no vault", () => {
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("empty-workspace-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-toolbar")).toBeNull();
    expect(screen.queryByTestId("board-body")).toBeNull();
  });

  it("initializes issue filters from URL params (via useIssueUrlSync)", async () => {
    navigationState.searchParams = new URLSearchParams(
      "view=list&status=todo&priority=high&q=auth",
    );
    render(wrap(<IssuesWorkspace />));

    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
    expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
    expect(useIssueStore.getState().searchQuery).toBe("auth");
  });

  it("persists a URL-applied filter as the last-used filter (REEF-009)", async () => {
    navigationState.searchParams = new URLSearchParams("status=closed");

    render(wrap(<IssuesWorkspace />));

    // The URL filter wins for the current view AND becomes the remembered
    // last-used filter, so a later bare /issues entry restores it (not a stale
    // saved value).
    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        status: ["closed"],
      });
    });
  });

  it("persists a user filter change made during the in-flight restore (REEF-009)", async () => {
    await setPersistedIssueFilter("reef-acme", { status: ["closed"] });

    render(wrap(<IssuesWorkspace />));
    // The user edits before the async restore resolves → the store is
    // non-pristine, so the restore is skipped and the user's edit (not the
    // saved "closed") should be what gets persisted.
    act(() => useIssueStore.getState().setFilter({ priority: ["high"] }));

    await waitFor(async () => {
      expect(await getPersistedIssueFilter("reef-acme")).toEqual({
        priority: ["high"],
      });
    });
  });

  it("mirrors a restored personal filter onto the URL via replace (REEF-010)", async () => {
    // Workspace-level wiring exercises the same hook: a clean pristine restore
    // (saved filter, no URL params, no concurrent edit) should reach router.replace
    // — the path that would crash if the next/navigation mock lacked `replace`.
    await setPersistedIssueFilter("reef-acme", { status: ["todo"] });

    render(wrap(<IssuesWorkspace />));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/workspace/reef-acme/issues?status=todo",
        {
          scroll: false,
        },
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
