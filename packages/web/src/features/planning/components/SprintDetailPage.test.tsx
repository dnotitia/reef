import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  catalogState,
  issueState,
  navigationState,
  mockCatalogRefetch,
  mockIssueRefetch,
} = vi.hoisted(() => ({
  catalogState: { current: {} as Record<string, unknown> },
  issueState: { current: {} as Record<string, unknown> },
  navigationState: {
    params: { id: "00000000-0000-4000-8000-000000000001", vault: "reef-acme" },
    searchParams: new URLSearchParams(),
  },
  mockCatalogRefetch: vi.fn(() => Promise.resolve()),
  mockIssueRefetch: vi.fn(() => Promise.resolve()),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigationState.params,
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/features/planning/hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: () => catalogState.current,
}));

vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: () => issueState.current,
}));

vi.mock("@/features/issues/components/filters/IssuesWorkspace", () => ({
  IssuesWorkspace: ({
    fixedSprintId,
    fixedSprintName,
  }: {
    fixedSprintId?: string;
    fixedSprintName?: string;
  }) => (
    <div
      data-testid="fixed-issues-workspace"
      data-fixed-sprint-id={fixedSprintId}
      data-fixed-sprint-name={fixedSprintName}
    />
  ),
}));

vi.mock("@/features/issues/components/filters/ViewSwitcher", () => ({
  ViewSwitcher: ({ activeLayout }: { activeLayout: string }) => (
    <div data-testid="detail-view-switcher" data-active-layout={activeLayout} />
  ),
}));

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({ value }: { value: string }) => (
    <div data-testid="goal-markdown">{value}</div>
  ),
}));

import { IssueListItemSchema, type PlanningCatalog } from "@reef/core";
import { SprintDetailPage } from "./SprintDetailPage";

const SPRINT_ID = "00000000-0000-4000-8000-000000000001";
const SPRINT: PlanningCatalog["sprints"][number] = {
  id: SPRINT_ID,
  name: "Sprint One",
  status: "active",
  start_date: "2026-08-31",
  end_date: "2026-09-07",
  goal: "Ship the sprint detail.",
  capacity_points: 8,
};
const CATALOG: PlanningCatalog = {
  sprints: [SPRINT],
  milestones: [],
  releases: [],
};

function issue(
  overrides: Partial<ReturnType<typeof IssueListItemSchema.parse>> = {},
) {
  return IssueListItemSchema.parse({
    id: "REEF-001",
    title: "A sprint issue",
    status: "todo",
    created_at: "2026-08-31T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-08-31T00:00:00.000Z",
    updated_by: "alice",
    issue_type: "task",
    priority: "medium",
    assigned_to: null,
    requester: null,
    reporter: null,
    start_date: null,
    due_date: null,
    milestone_id: null,
    sprint_id: SPRINT_ID,
    release_id: null,
    estimate_points: 3,
    severity: null,
    rank: null,
    closed_at: null,
    closed_reason: null,
    parent_id: null,
    labels: [],
    depends_on: [],
    related_to: [],
    blocks: [],
    archived_at: null,
    ...overrides,
  });
}

function wrap(ui: ReactNode) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <IntlTestProvider>{ui}</IntlTestProvider>
    </QueryClientProvider>
  );
}

describe("SprintDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.params = { id: SPRINT_ID, vault: "reef-acme" };
    navigationState.searchParams = new URLSearchParams();
    catalogState.current = {
      data: CATALOG,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: mockCatalogRefetch,
    };
    issueState.current = {
      data: [issue(), issue({ id: "REEF-002", status: "done" })],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: mockIssueRefetch,
    };
  });

  it("renders the sprint header and fixed Board/List workspace", () => {
    render(wrap(<SprintDetailPage />));

    expect(screen.getByRole("heading", { name: "Sprint One" })).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.getByTestId("sprint-detail-date-range")).toHaveTextContent(
      "Aug 31, 2026 – Sep 7, 2026",
    );
    expect(screen.getByTestId("sprint-detail-count")).toHaveTextContent("1/2");
    expect(screen.getByTestId("sprint-detail-goal")).toHaveTextContent(
      "Ship the sprint detail.",
    );
    expect(screen.getByTestId("sprint-burnup-slot")).toHaveAttribute(
      "data-slot",
      "sprint-burnup",
    );
    expect(screen.getByTestId("fixed-issues-workspace")).toHaveAttribute(
      "data-fixed-sprint-id",
      SPRINT_ID,
    );
  });

  it("distinguishes a missing sprint from a catalog error", () => {
    catalogState.current = {
      data: { ...CATALOG, sprints: [] },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: mockCatalogRefetch,
    };

    const missingView = render(wrap(<SprintDetailPage />));

    expect(screen.getByTestId("sprint-detail-not-found")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to Planning" }),
    ).toHaveAttribute("href", "/workspace/reef-acme/planning");
    expect(screen.queryByTestId("fixed-issues-workspace")).toBeNull();
    missingView.unmount();

    catalogState.current = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: mockCatalogRefetch,
    };
    render(wrap(<SprintDetailPage />));
    expect(screen.getByTestId("sprint-detail-catalog-error")).toBeVisible();
    expect(screen.queryByTestId("sprint-detail-not-found")).toBeNull();
  });

  it("offers Retry for a sprint issue load failure without changing identity", async () => {
    issueState.current = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: mockIssueRefetch,
    };
    const user = userEvent.setup();
    render(wrap(<SprintDetailPage />));

    expect(screen.getByTestId("sprint-detail-issue-error")).toBeVisible();
    expect(screen.queryByTestId("sprint-detail-not-found")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockIssueRefetch).toHaveBeenCalledTimes(1);
  });

  it("uses the list layout on a detail deep link", () => {
    navigationState.searchParams = new URLSearchParams("view=list");
    render(wrap(<SprintDetailPage />));
    expect(screen.getByTestId("detail-view-switcher")).toHaveAttribute(
      "data-active-layout",
      "list",
    );
  });
});
