import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { apiFetch } from "@/lib/apiClient";
import type { IssueMetadata } from "@reef/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineBody } from "./TimelineBody";

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
    id: "REEF-100",
    title: "Scheduled A",
    status: "todo",
    priority: "high",
    start_date: "2026-05-10",
    due_date: "2026-05-12",
  },
  {
    ...base,
    id: "REEF-101",
    title: "Scheduled B",
    status: "done",
    priority: "low",
    due_date: "2026-06-01",
  },
  {
    ...base,
    id: "REEF-102",
    title: "No dates",
    status: "in_progress",
  },
  {
    ...base,
    id: "REEF-103",
    title: "Blocked scheduled",
    status: "todo",
    start_date: "2026-05-14",
    due_date: "2026-05-20",
    depends_on: ["REEF-104"],
  },
  {
    ...base,
    id: "REEF-104",
    title: "Blocking dependency",
    status: "todo",
    start_date: "2026-04-10",
    due_date: "2026-04-11",
  },
];

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("TimelineBody", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 4, 22, 12));
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

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests /api/issues?vault={vault} for the active vault", async () => {
    render(wrap(<TimelineBody vault="reef-acme" />));

    await screen.findByText("Scheduled A");
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/api/issues?vault=reef-acme&sort_field=priority&sort_order=desc",
    );
  });

  it("renders scheduled issues grouped by status", async () => {
    render(wrap(<TimelineBody vault="reef-acme" />));

    expect(await screen.findByText("Scheduled A")).toBeInTheDocument();
    expect(screen.getByText("Scheduled B")).toBeInTheDocument();
    // `open`'s group label reads "Todo" (REEF-109).
    expect(screen.getAllByText("Todo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
  });

  it("treats a backlog-only result set as an empty timeline (REEF-109)", async () => {
    mockApiFetch.mockImplementation(async (url) => {
      const path = String(url);
      if (path.startsWith("/api/vault-members")) {
        return new Response(JSON.stringify({ users: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          issues: [
            {
              ...base,
              id: "REEF-200",
              title: "Backlog only",
              status: "backlog",
              start_date: "2026-05-10",
              due_date: "2026-05-12",
            },
          ],
        }),
        { status: 200 },
      );
    });

    render(wrap(<TimelineBody vault="reef-acme" />));

    // The timeline groups by workflow status, so a backlog set displays
    // nothing — the empty state should show instead of a blank grid.
    expect(
      await screen.findByText(/Your timeline is empty/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Backlog only")).toBeNull();
  });

  it("renders issues without dates in the Unscheduled section", async () => {
    render(wrap(<TimelineBody vault="reef-acme" />));

    expect(
      await screen.findByTestId("timeline-unscheduled"),
    ).toBeInTheDocument();
    expect(screen.getByText("No dates")).toBeInTheDocument();
  });

  it("applies client filters and forwards search to the server as `q` (REEF-034)", async () => {
    // The priority facet still narrows client-side; the free-text search now
    // rides as a server `q=` param (the mock returns the full set, so the
    // visible narrowing here is the priority facet).
    useIssueStore.setState({
      filter: { priority: ["high"] },
      searchQuery: "Scheduled",
      selectedIssueId: null,
    });

    render(wrap(<TimelineBody vault="reef-acme" />));

    expect(await screen.findByText("Scheduled A")).toBeInTheDocument();
    expect(screen.queryByText("Scheduled B")).toBeNull();
    expect(screen.queryByText("No dates")).toBeNull();
    const issueUrls = mockApiFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.startsWith("/api/issues"));
    expect(issueUrls.some((u) => u.includes("q=Scheduled"))).toBe(true);
  });

  it("applies dependency filters", async () => {
    useIssueStore.setState({
      filter: { dependencyFilter: ["blocked"] },
      searchQuery: "",
      selectedIssueId: null,
    });

    render(wrap(<TimelineBody vault="reef-acme" />));

    expect(await screen.findByText("Blocked scheduled")).toBeInTheDocument();
    expect(screen.queryByText("Scheduled A")).toBeNull();
  });

  it("opens the issue detail sheet route when a timeline item is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<TimelineBody vault="reef-acme" />));

    const issueButtons = await screen.findAllByRole("button", {
      name: /REEF-100/i,
    });
    await user.click(issueButtons[0]);

    expect(mockPush).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-100",
    );
  });

  it("preserves the current ?view= when opening an issue (REEF-222)", async () => {
    navigationState.searchParams = new URLSearchParams("view=timeline");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<TimelineBody vault="reef-acme" />));

    const issueButtons = await screen.findAllByRole("button", {
      name: /REEF-100/i,
    });
    await user.click(issueButtons[0]);

    expect(mockPush).toHaveBeenCalledWith(
      "/workspace/reef-acme/issues/REEF-100?view=timeline",
    );
  });

  it("scrolls back to today when Today is clicked in the current quarter (REEF-078)", async () => {
    // System time (2026-05-22) sits in Q2 2026 — the current quarter — so the
    // Today button re-centers via the grid's imperative scroll rather than
    // switching quarters. jsdom implements none of the scroll geometry, so stub
    // what the anchor math reads.
    const scrollToSpy = vi.fn();
    // jsdom implements neither Element.scrollTo nor reduced-motion media
    // queries, so install both. clientWidth stays 0 here, which is fine — the
    // anchor math still returns a finite scrollLeft.
    HTMLElement.prototype.scrollTo =
      scrollToSpy as unknown as HTMLElement["scrollTo"];
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(wrap(<TimelineBody vault="reef-acme" />));
    await screen.findByText("Scheduled A");

    await user.click(screen.getByRole("button", { name: /go to today/i }));

    expect(scrollToSpy).toHaveBeenCalledWith(
      expect.objectContaining({ left: expect.any(Number) }),
    );
  });
});
