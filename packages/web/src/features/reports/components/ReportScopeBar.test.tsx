import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
import { DEFAULT_REPORT_FILTERS, type ReportFilters } from "../lib/aggregate";
import { ReportScopeBar } from "./ReportScopeBar";

const mockApiFetch = vi.mocked(apiFetch);

function respond(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function renderBar(filters: ReportFilters = DEFAULT_REPORT_FILTERS) {
  const onChange = vi.fn();
  render(wrap(<ReportScopeBar filters={filters} onChange={onChange} />));
  return { onChange };
}

describe("ReportScopeBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseActiveVault.mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: () => Promise.resolve(),
    });
    mockApiFetch.mockImplementation((input) => {
      const path = String(input);
      if (path.startsWith("/api/planning")) {
        return respond({ sprints: [], milestones: [], releases: [] });
      }
      return respond({ users: [] });
    });
  });

  it("reuses the issues filter leaves for the issue facets", () => {
    renderBar();
    expect(screen.getByTestId("report-scope-bar")).toBeInTheDocument();
    // Period + Scope stay reports.
    expect(screen.getByText("Last 12 weeks")).toBeInTheDocument();
    expect(screen.getByText("Active work")).toBeInTheDocument();
    // Sprint / milestone / release / assignee / label come from the shared leaves.
    expect(screen.getByTestId("report-sprint-input")).toBeInTheDocument();
    expect(screen.getByTestId("report-milestone-input")).toBeInTheDocument();
    expect(screen.getByTestId("report-release-input")).toBeInTheDocument();
    expect(screen.getByTestId("report-assignee-filter")).toBeInTheDocument();
    expect(screen.getByTestId("report-label-input")).toBeInTheDocument();
  });

  it("keeps report controls on readable responsive tracks", () => {
    renderBar();
    expect(screen.getByTestId("report-scope-bar").className).toContain(
      "grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]",
    );
  });

  it("keeps default Period and Scope from reading as active filters", () => {
    renderBar();

    expect(screen.getByLabelText("Period").className).not.toContain(
      "bg-brand/10",
    );
    expect(screen.getByLabelText("Scope").className).not.toContain(
      "bg-brand/10",
    );
  });

  it("marks non-default Period and Scope as active filters", () => {
    renderBar({
      ...DEFAULT_REPORT_FILTERS,
      period: "4w",
      scope: "all",
    });

    expect(screen.getByLabelText("Period").className).toContain("bg-brand/10");
    expect(screen.getByLabelText("Scope").className).toContain("bg-brand/10");
  });

  it("renders the Measure control defaulting to issue count (REEF-188)", () => {
    renderBar();
    expect(screen.getByLabelText("Measure")).toBeInTheDocument();
    expect(screen.getByText("Issue count")).toBeInTheDocument();
  });

  it("marks a non-default Story points measure as active (REEF-188)", () => {
    renderBar({ ...DEFAULT_REPORT_FILTERS, measure: "points" });
    expect(screen.getByLabelText("Measure").className).toContain("bg-brand/10");
    expect(screen.getByText("Story points")).toBeInTheDocument();
  });

  it("commits a label chip as a comma-joined filter string", () => {
    const { onChange } = renderBar();
    const input = screen.getByTestId("report-label-input");
    fireEvent.change(input, { target: { value: "risk" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_REPORT_FILTERS,
      label: "risk",
    });
  });

  it("renders existing label filters as chips", () => {
    renderBar({ ...DEFAULT_REPORT_FILTERS, label: "ui,risk" });
    expect(screen.getByText("ui")).toBeInTheDocument();
    expect(screen.getByText("risk")).toBeInTheDocument();
  });
});
