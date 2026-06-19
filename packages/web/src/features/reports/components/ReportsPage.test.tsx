import type { IssueMetadata } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

const { mockUseActiveVault } = vi.hoisted(() => ({
  mockUseActiveVault: vi.fn(),
}));

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: mockUseActiveVault,
}));

import { apiFetch } from "@/lib/apiClient";
import { ReportsPage } from "./ReportsPage";

const mockApiFetch = vi.mocked(apiFetch);

const issues: IssueMetadata[] = [
  {
    id: "REEF-001",
    title: "Fix sync deadline",
    status: "todo",
    priority: "critical",
    created_at: "2026-05-01T00:00:00.000Z",
    created_by: "alice",
    updated_at: "2026-04-01T00:00:00.000Z",
    updated_by: "alice",
    assigned_to: "alice",
    due_date: "2026-04-20T00:00:00.000Z",
    labels: ["risk"],
    depends_on: ["REEF-099"],
  },
  {
    id: "REEF-002",
    title: "Write docs",
    status: "todo",
    priority: "low",
    created_at: "2026-05-02T00:00:00.000Z",
    created_by: "bob",
    updated_at: "2026-05-25T00:00:00.000Z",
    updated_by: "bob",
    assigned_to: "bob",
    labels: ["docs"],
  },
];

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * URL-aware apiFetch mock. The scope bar reuses the issues filter leaves, so
 * rendering it fires planning-catalog and vault-member lookups alongside the
 * issues list; route each to a benign empty payload.
 */
function mockApi(issuesPayload: IssueMetadata[]) {
  mockApiFetch.mockImplementation((input) => {
    const path = String(input);
    if (path.startsWith("/api/planning")) {
      return Promise.resolve(
        respond({ sprints: [], milestones: [], releases: [] }),
      );
    }
    if (path.startsWith("/api/vault-members")) {
      return Promise.resolve(respond({ users: [] }));
    }
    return Promise.resolve(respond({ issues: issuesPayload }));
  });
}

/** Commit a label into the reuse `LabelChipInput` (Enter-based chip UX). */
function setLabelFilter(value: string) {
  const input = screen.getByTestId("report-label-input");
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-05-26T00:00:00.000Z").getTime(),
    );
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
  });

  it('renders the "pick a workspace" CTA when no vault is selected', () => {
    mockUseActiveVault.mockReturnValue({
      vault: "",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    render(wrap(<ReportsPage />));
    expect(screen.getByText(/Pick a workspace/i)).toBeInTheDocument();
  });

  it("names the active workspace in the Reports header subtitle, like its peer pages (REEF-260)", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    // Reports is vault-scoped, so its header now carries the workspace name as a
    // subtitle just like the Issues / Planning / Activity headers.
    const heading = await screen.findByRole("heading", {
      name: "Reports",
      level: 1,
    });
    const header = heading.closest('[data-slot="page-header"]');
    expect(header).not.toBeNull();
    expect(header).toHaveTextContent("reef-acme");
  });

  it("requests /api/issues?vault={vault} when a vault is active", async () => {
    mockApiFetch.mockResolvedValue(
      new Response(JSON.stringify({ issues: [] }), { status: 200 }),
    );

    render(wrap(<ReportsPage />));
    // Eventually issuesQuery.isPending flips to false (issues=[]); aggregates render.
    await screen.findByText(/Reports|Status|Priority/i);
    expect(mockApiFetch).toHaveBeenCalledWith("/api/issues?vault=reef-acme");
  });

  it("renders the default report scope bar and risk-first summary", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    expect(await screen.findByTestId("report-scope-bar")).toBeInTheDocument();
    // "Last 12 weeks" now also names the window on the Throughput card, so scope
    // the control assertion to the bar (REEF-185).
    expect(
      within(screen.getByTestId("report-scope-bar")).getByText("Last 12 weeks"),
    ).toBeInTheDocument();
    expect(screen.getByText("Active work")).toBeInTheDocument();
    // The shared issue-filter leaves are reused for the issue facets (REEF-074).
    expect(screen.getByTestId("report-sprint-input")).toBeInTheDocument();
    expect(screen.getByTestId("report-assignee-filter")).toBeInTheDocument();
    expect(screen.getByTestId("report-label-input")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kpi-at-risk")).getByText("1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("report-card-risk-map")).toBeInTheDocument();
    expect(screen.getByTestId("report-card-throughput")).toBeInTheDocument();
  });

  it("groups the report cards into named scan sections (REEF-248)", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    // The long card stack is segmented into three labeled bands so the page has
    // a scan order and entry point, not one flat wall. Section labels are the
    // level-2 headings (cards are h3), so the level filter is unambiguous.
    for (const label of ["Snapshot", "Flow & forecast", "Breakdown"]) {
      expect(
        screen.getByRole("heading", { name: label, level: 2 }),
      ).toBeInTheDocument();
    }
  });

  it("renders By type with the neutral value bar, not per-type identity fills (REEF-248)", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    const card = await screen.findByTestId("report-card-by-type");
    // The breakdown bar uses the single brand value-token, matching By severity /
    // Top assignees / Top labels...
    expect(card.querySelector("[style*='var(--brand)']")).not.toBeNull();
    // ...and no longer leaks a per-type identity color (task → status-open,
    // bug → priority-critical, epic → ai, ...) into the card.
    for (const token of ["--type", "--ai", "--priority", "--status"]) {
      expect(card.querySelector(`[style*='${token}']`)).toBeNull();
    }
  });

  it("keeps the 2-D Risk map but drops the duplicate 1-D By priority and Aging cards (REEF-184)", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    // The 2-D matrix is the single home for the priority × last-update axes...
    const riskMap = screen.getByTestId("report-card-risk-map");
    expect(riskMap).toBeInTheDocument();
    // ...and its open-work population is now labelled explicitly so the card's
    // counts is not mistaken for the in-scope total.
    expect(within(riskMap).getByText(/open work/i)).toBeInTheDocument();
    // The 1-D marginals the matrix already encodes are gone.
    expect(
      screen.queryByTestId("report-card-by-priority"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("report-card-aging")).not.toBeInTheDocument();
  });

  it("shows net throughput once — in the Throughput card, not the KPI grid (REEF-192)", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    // The KPI grid no longer carries a Net throughput tile...
    expect(screen.queryByTestId("kpi-net-throughput")).not.toBeInTheDocument();
    expect(screen.queryByText("Net throughput")).not.toBeInTheDocument();
    // ...the net figure lives once, in the Throughput card subtitle.
    expect(
      within(screen.getByTestId("report-card-throughput")).getByText(/ net$/),
    ).toBeInTheDocument();
  });

  it("names the period window on the Throughput card and re-scopes it on change (REEF-185)", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    // The one card the period re-scopes names its active window, so changing the
    // period reads as a Throughput action, not a broken global control.
    expect(
      within(screen.getByTestId("report-card-throughput")).getByText(
        /Last 12 weeks/,
      ),
    ).toBeInTheDocument();

    // Pick a different window on the (non-searchable) period combobox.
    fireEvent.click(screen.getByLabelText("Period"));
    fireEvent.click(screen.getByText("Last 4 weeks"));

    expect(
      within(screen.getByTestId("report-card-throughput")).getByText(
        /Last 4 weeks/,
      ),
    ).toBeInTheDocument();
  });

  it("labels each card's population so adjacent totals are interpretable (REEF-185)", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    // In-scope cards say "In scope"; open-work cards say "Open work" — so the
    // Risk map / Deadlines counts do not read as the in-scope total.
    expect(
      within(screen.getByTestId("report-card-by-type")).getByText("In scope"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("report-card-deadlines")).getByText(
        /Open work/,
      ),
    ).toBeInTheDocument();
  });

  it("updates report results when the label scope changes", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    setLabelFilter("docs");

    expect(
      within(screen.getByTestId("kpi-at-risk")).getByText("0"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("kpi-active")).getByText("1"),
    ).toBeInTheDocument();
  });

  it("shows an empty report state when filters match no issues", async () => {
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    setLabelFilter("missing");

    expect(screen.getByText(/No matching report data/i)).toBeInTheDocument();
  });

  it("can clear a parent rollup drill from the empty state (REEF-187)", async () => {
    // A parent and its single child. The parent axis has no scope-bar control,
    // so once a further filter empties the page the rollup row is gone — the
    // empty-state affordance is the way to undo the parent scope.
    mockApi([
      {
        id: "E1",
        title: "Reports epic",
        status: "in_progress",
        created_at: "2026-05-01T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-01T00:00:00.000Z",
        updated_by: "alice",
      },
      {
        id: "c1",
        parent_id: "E1",
        title: "Child task",
        status: "todo",
        created_at: "2026-05-02T00:00:00.000Z",
        created_by: "alice",
        updated_at: "2026-05-02T00:00:00.000Z",
        updated_by: "alice",
        labels: ["docs"],
      },
    ]);

    render(wrap(<ReportsPage />));
    await screen.findByTestId("report-scope-bar");

    // Drill into the parent (the parent axis has items here), then scope to
    // zero with a label that matches nothing.
    fireEvent.click(screen.getByTestId("health-rollup-row-E1"));
    setLabelFilter("missing");
    expect(screen.getByText(/No matching report data/i)).toBeInTheDocument();

    const clear = screen.getByTestId("reports-clear-parent-scope");
    expect(clear).toHaveTextContent("Reports epic");
    fireEvent.click(clear);

    // Parent facet cleared → its affordance disappears (the label filter still
    // scopes the page, so the empty state itself remains).
    expect(
      screen.queryByTestId("reports-clear-parent-scope"),
    ).not.toBeInTheDocument();
  });

  it("surfaces the previously-dead bySeverity aggregate as a By severity card (REEF-186)", async () => {
    mockApi([
      { ...issues[0], severity: "critical" },
      { ...issues[1], severity: "minor" },
    ]);

    render(wrap(<ReportsPage />));

    // Scope to the card: "Critical" also labels the Risk map priority row, so a
    // global getByText would be ambiguous.
    const card = await screen.findByTestId("report-card-by-severity");
    expect(within(card).getByText("Critical")).toBeInTheDocument();
    expect(within(card).getByText("Minor")).toBeInTheDocument();
    expect(within(card).getByText("In scope")).toBeInTheDocument();
  });

  it("omits the By severity card when no issue carries a severity (REEF-186)", async () => {
    // The default fixture sets no severity, so the card stays absent rather than
    // rendering a perpetually-empty panel.
    mockApi(issues);

    render(wrap(<ReportsPage />));

    await screen.findByTestId("report-scope-bar");
    expect(
      screen.queryByTestId("report-card-by-severity"),
    ).not.toBeInTheDocument();
  });
});
