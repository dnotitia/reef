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

const {
  mockPush,
  mockReplace,
  mockUseActiveVault,
  mockUsePlanningCatalog,
  navigationState,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  mockUseActiveVault: vi.fn(),
  mockUsePlanningCatalog: vi.fn(),
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

vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: mockUsePlanningCatalog,
}));

// Mock the heavy body components and the filter toolbar so the test focuses
// on the workspace's view-switching and chrome wiring.
vi.mock("@/features/board/components/KanbanBoard", () => ({
  KanbanBoard: ({
    vault,
    groupBy,
    fixedSprintId,
  }: {
    vault: string;
    groupBy?: string;
    fixedSprintId?: string;
  }) => (
    <div
      data-testid="board-body"
      data-vault={vault}
      data-group-by={groupBy}
      data-fixed-sprint-id={fixedSprintId}
    />
  ),
}));
vi.mock("@/features/issues/components/list/IssueListTable", () => ({
  IssueListTable: ({
    vault,
    groupBy,
    fixedSprintId,
  }: {
    vault: string;
    groupBy?: string;
    fixedSprintId?: string;
  }) => (
    <div
      data-testid="list-body"
      data-vault={vault}
      data-group-by={groupBy}
      data-fixed-sprint-id={fixedSprintId}
    />
  ),
}));
vi.mock("@/features/issues/components/bulk/IssueBulkActionBar", () => ({
  IssueBulkActionBar: ({ preset }: { preset?: string }) => (
    <div data-testid="issue-bulk-action-bar" data-preset={preset} />
  ),
}));
vi.mock("@/features/timeline/components/TimelineBody", () => ({
  TimelineBody: ({ vault }: { vault: string }) => (
    <div data-testid="timeline-body" data-vault={vault} />
  ),
}));
vi.mock("@/features/issues/components/filters/IssueFilterToolbar", () => ({
  IssueFilterToolbar: ({
    groupBy,
    showSortControl,
    supportsRankOrder,
    showsBacklogReorderHint,
    fixedSprintId,
    fixedSprintName,
  }: {
    groupBy?: string;
    showSortControl?: boolean;
    supportsRankOrder?: boolean;
    showsBacklogReorderHint?: boolean;
    fixedSprintId?: string;
    fixedSprintName?: string;
  }) => (
    <div
      data-testid="filter-toolbar"
      data-group-by={groupBy}
      data-show-sort={showSortControl}
      data-supports-rank={supportsRankOrder}
      data-shows-drag-hint={showsBacklogReorderHint}
      data-fixed-sprint-id={fixedSprintId}
      data-fixed-sprint-name={fixedSprintName}
    >
      {showSortControl ? (
        <span data-testid="sort-control" data-location="filter-toolbar" />
      ) : null}
    </div>
  ),
}));

import { useIssueSelectionStore } from "@/features/issues/stores/useIssueSelectionStore";
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
    mockUsePlanningCatalog.mockReturnValue({
      data: { sprints: [], milestones: [], releases: [] },
      isPending: false,
      isError: false,
    });
    useIssueStore.setState({
      filter: {},
      filterVault: null,
      searchQuery: "",
      selectedIssueId: null,
      listOptionalColumns: [],
    });
    useIssueSelectionStore.getState().setRunning(false);
    useIssueSelectionStore.getState().clearForContextChange();
    await db.config.clear();
  });

  it("defaults to the board view when no ?view= is present", () => {
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("board-body")).toBeInTheDocument();
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-show-sort",
      "true",
    );
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-supports-rank",
      "true",
    );
    expect(screen.getByTestId("sort-control")).toHaveAttribute(
      "data-location",
      "filter-toolbar",
    );
    expect(
      screen.getByTestId("sort-control").closest('[data-slot="page-header"]'),
    ).toBeNull();
    expect(screen.queryByTestId("issue-bulk-action-bar")).toBeNull();
    expect(screen.queryByTestId("list-body")).toBeNull();
    expect(screen.queryByTestId("timeline-body")).toBeNull();
  });

  it("keeps scope beside the title and layout in the right action area", () => {
    render(wrap(<IssuesWorkspace />));

    const scope = screen.getByTestId("scope-switcher");
    const view = screen.getByTestId("view-switcher");
    expect(
      scope.closest('[data-slot="page-header-title-adjacent"]'),
    ).not.toBeNull();
    expect(scope.closest('[data-slot="page-header-actions"]')).toBeNull();
    expect(view.closest('[data-slot="page-header-actions"]')).not.toBeNull();
  });

  it("places the current sprint shortcut beside the scope in the shared header", () => {
    mockUsePlanningCatalog.mockReturnValue({
      data: {
        sprints: [
          {
            id: "sprint-13",
            name: "Sprint 13",
            status: "active",
            start_date: "2026-09-01",
            end_date: "2026-09-14",
            goal: "Ship the header",
          },
        ],
        milestones: [],
        releases: [],
      },
      isPending: false,
      isError: false,
    });

    render(wrap(<IssuesWorkspace />));

    const shortcut = screen.getByTestId("current-sprint-shortcut");
    const link = screen.getByRole("link", {
      name: "Open current sprint details: Sprint 13",
    });
    expect(
      shortcut.closest('[data-slot="page-header-title-adjacent"]'),
    ).not.toBeNull();
    expect(link).toHaveAttribute(
      "href",
      "/workspace/reef-acme/planning/sprints/sprint-13",
    );
    expect(link).toHaveAttribute("title", "Sprint 13");
    expect(link).toHaveClass("type-control", "focus-visible:ring-focus-ring");
    expect(link).not.toHaveClass("focus-visible:ring-brand-focus/40");
  });

  it("does not add the current sprint shortcut to Backlog", () => {
    mockUsePlanningCatalog.mockReturnValue({
      data: {
        sprints: [
          {
            id: "sprint-13",
            name: "Sprint 13",
            status: "active",
            start_date: "2026-09-01",
            end_date: "2026-09-14",
            goal: null,
          },
        ],
        milestones: [],
        releases: [],
      },
      isPending: false,
      isError: false,
    });
    navigationState.searchParams = new URLSearchParams(
      "scope=backlog&view=list",
    );

    render(wrap(<IssuesWorkspace />));

    expect(screen.queryByTestId("current-sprint-shortcut")).toBeNull();
  });

  it("renders the list body when ?view=list", () => {
    navigationState.searchParams = new URLSearchParams("view=list");
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("list-body")).toBeInTheDocument();
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-supports-rank",
      "true",
    );
    expect(screen.getByTestId("issue-bulk-action-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("board-body")).toBeNull();
  });

  it("pins a detail workspace to its sprint without exposing scope switching", () => {
    navigationState.pathname =
      "/workspace/reef-acme/planning/sprints/fixed-sprint";
    navigationState.searchParams = new URLSearchParams("view=list");
    render(
      wrap(
        <IssuesWorkspace
          hideHeader
          fixedSprintId="fixed-sprint"
          fixedSprintName="Sprint One"
        />,
      ),
    );

    expect(screen.getByTestId("list-body")).toHaveAttribute(
      "data-fixed-sprint-id",
      "fixed-sprint",
    );
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-fixed-sprint-name",
      "Sprint One",
    );
    expect(screen.queryByTestId("scope-switcher")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Issues" })).toBeNull();
  });

  it("passes the shareable group choice to the toolbar and active view", () => {
    navigationState.searchParams = new URLSearchParams("view=list&group=label");
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-group-by",
      "label",
    );
    expect(screen.getByTestId("list-body")).toHaveAttribute(
      "data-group-by",
      "label",
    );
  });

  it("renders the Backlog bulk preset without changing the body contract", () => {
    navigationState.searchParams = new URLSearchParams(
      "scope=backlog&view=list",
    );
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("issue-bulk-action-bar")).toHaveAttribute(
      "data-preset",
      "backlog",
    );
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-supports-rank",
      "true",
    );
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-shows-drag-hint",
      "true",
    );
    expect(screen.queryByTestId("list-body")).toBeNull();
  });

  it("clears selection on a context change even while a bulk job is running", async () => {
    navigationState.searchParams = new URLSearchParams("view=list");
    useIssueSelectionStore.getState().toggle("REEF-101");
    useIssueSelectionStore.getState().setRunning(true);

    render(wrap(<IssuesWorkspace />));

    await waitFor(() => {
      expect(useIssueSelectionStore.getState().selectedIds.size).toBe(0);
    });
    expect(useIssueSelectionStore.getState().running).toBe(true);
  });

  it("renders the timeline body when ?view=timeline", () => {
    navigationState.searchParams = new URLSearchParams("view=timeline");
    render(wrap(<IssuesWorkspace />));
    expect(screen.getByTestId("timeline-body")).toBeInTheDocument();
    expect(screen.getByTestId("filter-toolbar")).toHaveAttribute(
      "data-show-sort",
      "false",
    );
    expect(screen.queryByTestId("sort-control")).toBeNull();
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
