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

// `data-next-link` marks anchors routed through Next `Link`; a raw `<a>` lacks
// it, so the empty-state CTA assertion fails if the link regresses to a
// full-reload anchor (REEF-262).
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a data-next-link="true" href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { BacklogView } from "./BacklogView";

const mockApiFetch = vi.mocked(apiFetch);

const base = {
  created_at: "2026-05-01T00:00:00.000Z",
  created_by: "alice",
  updated_at: "2026-05-01T00:00:00.000Z",
  updated_by: "alice",
} satisfies Partial<IssueMetadata>;

// A backlog issue (kept) and an active one (the client pin drops it even if the
// mocked server returns it).
const issues: IssueMetadata[] = [
  {
    ...base,
    id: "REEF-1",
    title: "Deferred idea",
    status: "backlog",
    priority: "high",
  },
  {
    ...base,
    id: "REEF-2",
    title: "Committed work",
    status: "todo",
    priority: "low",
  },
];

function wrap(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

function mockList(rows: IssueMetadata[]) {
  mockApiFetch.mockImplementation(async (url) => {
    const path = String(url);
    if (path.startsWith("/api/vault-members")) {
      return new Response(JSON.stringify({ users: [] }), { status: 200 });
    }
    if (path.startsWith("/api/issues/")) {
      // PATCH from the inline status picker — echo a minimal document.
      return new Response(
        JSON.stringify({ issue: { ...rows[0], status: "todo" }, content: "" }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ issues: rows }), { status: 200 });
  });
}

describe("BacklogView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navigationState.searchParams = new URLSearchParams();
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
  });

  it("pins the query to status=backlog and shows only backlog issues", async () => {
    mockList(issues);
    render(wrap(<BacklogView vault="reef-acme" />));

    expect(await screen.findByText("Deferred idea")).toBeInTheDocument();
    // The active issue is dropped by the client-side backlog pin.
    expect(screen.queryByText("Committed work")).toBeNull();

    // Server query carries status=backlog.
    const calledBacklog = mockApiFetch.mock.calls.some((c) =>
      String(c[0]).includes("status=backlog"),
    );
    expect(calledBacklog).toBe(true);

    // The body no longer restates a result count or the view identity — those
    // live in the shared chrome (the ViewSwitcher tab) now, so the body header
    // carries the reorder affordance (REEF-175).
    const header = screen.getByTestId("backlog-header");
    expect(header).not.toHaveTextContent("Backlog");
    expect(header).not.toHaveTextContent(/issue/i);
    expect(screen.getByTestId("backlog-order-mode")).toBeInTheDocument();
  });

  it("promotes a backlog issue to Todo via the inline status picker", async () => {
    mockList(issues);
    const user = userEvent.setup();
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");
    await user.click(screen.getByTestId("backlog-status-select-REEF-1"));
    await user.click(await screen.findByRole("option", { name: /Todo/i }));

    await waitFor(() => {
      const patch = mockApiFetch.mock.calls.find(
        (c) =>
          String(c[0]) === "/api/issues/REEF-1" &&
          (c[1] as RequestInit | undefined)?.method === "PATCH",
      );
      expect(patch).toBeTruthy();
      const body = JSON.parse(String((patch?.[1] as RequestInit).body));
      expect(body.update.patch).toEqual({ status: "todo" });
    });

    // Changing status should not navigate to the issue (click guard).
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("preserves ?view=backlog when opening an issue (REEF-222)", async () => {
    navigationState.searchParams = new URLSearchParams("view=backlog");
    mockList(issues);
    const user = userEvent.setup();
    render(wrap(<BacklogView vault="reef-acme" />));

    await user.click(await screen.findByText("Deferred idea"));
    expect(mockPush).toHaveBeenCalledWith("/issues/REEF-1?view=backlog");
  });

  it("renders the empty state with a client-side board link when the backlog has no issues (REEF-262)", async () => {
    mockList([]);
    render(wrap(<BacklogView vault="reef-acme" />));

    expect(await screen.findByTestId("backlog-empty")).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Go to the board/ });
    expect(cta).toHaveAttribute("href", "/issues?view=board");
    expect(cta).toHaveAttribute("data-next-link", "true");
  });

  it("shows a no-matches (not empty) state when triage filters hide the backlog (REEF-109)", async () => {
    // The backlog has issues, but an active priority filter excludes them all.
    mockList(issues);
    useIssueStore.setState({
      filter: { priority: ["low"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<BacklogView vault="reef-acme" />));

    expect(await screen.findByTestId("backlog-no-matches")).toBeInTheDocument();
    expect(screen.queryByTestId("backlog-empty")).toBeNull();
  });

  it("asks the server for rank ascending and shows a drag grip in manual order (REEF-129)", async () => {
    mockList(issues);
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");

    // Manual order (no explicit sort) → server sorts by rank ascending.
    const askedRank = mockApiFetch.mock.calls.some((c) => {
      const url = String(c[0]);
      return url.includes("sort_field=rank") && url.includes("sort_order=asc");
    });
    expect(askedRank).toBe(true);

    // The row carries a drag handle, and the in-body line is the drag
    // affordance just — the order name ("Manual order") now lives in the header
    // SortControl, not here (REEF-169).
    expect(screen.getByTestId("backlog-grip-REEF-1")).toBeInTheDocument();
    expect(screen.getByTestId("backlog-order-mode")).toHaveTextContent(
      "Drag to reorder",
    );
    expect(screen.getByTestId("backlog-order-mode")).not.toHaveTextContent(
      "Manual order",
    );
  });

  it("disables reordering and points to Manual order when a user sort is active (REEF-129, REEF-169)", async () => {
    mockList(issues);
    useIssueStore.setState({
      filter: { sortField: "priority", sortOrder: "desc" },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");

    // No grip in sorted mode. The body no longer restates the sort (it does not
    // leaks the raw `priority` field name) and carries no restore button — the
    // header SortControl owns the order vocabulary and the switch back to manual
    // order (REEF-169). The body just hints how to re-enable reordering.
    expect(screen.queryByTestId("backlog-grip-REEF-1")).toBeNull();
    expect(screen.getByTestId("backlog-order-mode")).toHaveTextContent(
      "Switch to Manual order to reorder",
    );
    expect(screen.getByTestId("backlog-order-mode")).not.toHaveTextContent(
      "Sorted by",
    );
    expect(
      screen.queryByRole("button", { name: /switch to manual order/i }),
    ).toBeNull();
  });

  it("renders the unranked divider between ranked rows and the unranked tail (REEF-129)", async () => {
    // One ranked issue, one unranked — both in the backlog.
    const mixed: IssueMetadata[] = [
      {
        ...base,
        id: "REEF-10",
        title: "Ranked top",
        status: "backlog",
        rank: 1000,
      },
      { ...base, id: "REEF-11", title: "Unranked tail", status: "backlog" },
    ];
    mockList(mixed);
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Ranked top");
    expect(screen.getByTestId("backlog-unranked-divider")).toBeInTheDocument();
  });

  it("omits the divider when every backlog issue is unranked (REEF-129)", async () => {
    mockList(issues); // neither test issue carries a rank
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");
    expect(screen.queryByTestId("backlog-unranked-divider")).toBeNull();
  });

  it("orders unranked issues newest-first by created_at, not by lexical id (REEF-129)", async () => {
    // REEF-1000 is newer than REEF-999 but sorts BEFORE it under lexical
    // `reef_id DESC` ('999' > '1000'). The created_at tiebreaker should win so the
    // newer issue is on top.
    const padded: IssueMetadata[] = [
      {
        ...base,
        id: "REEF-999",
        title: "Older padded",
        status: "backlog",
        created_at: "2026-05-01T00:00:00.000Z",
      },
      {
        ...base,
        id: "REEF-1000",
        title: "Newer overflow",
        status: "backlog",
        created_at: "2026-06-01T00:00:00.000Z",
      },
    ];
    mockList(padded);
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Newer overflow");
    const rows = screen.getAllByTestId("backlog-row");
    expect(rows[0]).toHaveTextContent("Newer overflow");
    expect(rows[1]).toHaveTextContent("Older padded");
  });

  it("disables reordering while archived rows are shown so they can't join the manual order (REEF-129)", async () => {
    mockList(issues);
    useIssueStore.setState({
      filter: { showArchived: true },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");
    expect(screen.queryByTestId("backlog-grip-REEF-1")).toBeNull();
  });

  it("keeps the archived flag in the manual-order query so Show archived still fetches archived backlog issues (REEF-176)", async () => {
    mockList(issues);
    useIssueStore.setState({
      filter: { showArchived: true },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");

    // showArchived gates what the SERVER returns (archived rows are excluded
    // otherwise), so the manual-order spine query should still ask for them — the
    // client pipeline does not restore rows that were does not fetched.
    const listUrls = mockApiFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("status=backlog"));
    expect(listUrls.length).toBeGreaterThan(0);
    expect(listUrls.every((u) => u.includes("archived=true"))).toBe(true);
  });

  it("keeps reordering enabled while a triage filter is active now that the backlog is fully ranked (REEF-176)", async () => {
    mockList(issues);
    // A priority filter narrows the backlog to a subset. Born-correct ranks
    // (REEF-176) make a filtered reorder safe — the moved row writes one
    // midpoint between its visible neighbors and hidden ranked rows keep their
    // keys — so the grip stays and the hint no longer says "Clear filters".
    useIssueStore.setState({
      filter: { priority: ["high"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");
    expect(screen.getByTestId("backlog-grip-REEF-1")).toBeInTheDocument();
    const hint = screen.getByTestId("backlog-order-mode");
    expect(hint).toHaveTextContent("Drag to reorder");
    expect(hint).not.toHaveTextContent("Clear filters to reorder");
  });

  it("fetches the full ranked backlog without the triage facets so a filtered reorder uses global neighbors (REEF-176)", async () => {
    mockList(issues);
    useIssueStore.setState({
      filter: { priority: ["high"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<BacklogView vault="reef-acme" />));

    await screen.findByText("Deferred idea");

    const listUrls = mockApiFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes("status=backlog"));
    expect(listUrls.length).toBeGreaterThan(0);
    // Manual order asks the server for the whole ranked backlog (the spine) ...
    expect(listUrls.every((u) => u.includes("sort_field=rank"))).toBe(true);
    // ... and does not pushes the active priority facet to the server (it is applied
    // client-side), so the drag-reorder computes against the global order.
    expect(listUrls.some((u) => u.includes("priority"))).toBe(false);
  });

  it("neutralizes a stray sprint/release/due value carried from another view (REEF-177)", async () => {
    // The shared filter store holds sprint/release/due values toggled in the list
    // view. The backlog hides those facets, so it should neutralize them: the rows
    // still show (the stray `due=overdue` would otherwise hide both dateless test
    // issues), the server query carries no sprint_id/release_id, and reorder stays
    // enabled — does not blocked behind a "Clear filters" pointing at an invisible
    // control.
    mockList(issues);
    useIssueStore.setState({
      filter: { sprint_id: ["spr-1"], release_id: ["rel-1"], due: ["overdue"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    render(wrap(<BacklogView vault="reef-acme" />));

    expect(await screen.findByText("Deferred idea")).toBeInTheDocument();
    // Not filtered to empty by the stray facets.
    expect(screen.queryByTestId("backlog-no-matches")).toBeNull();
    // Reorder stays enabled: the neutralized facets don't gate it.
    expect(screen.getByTestId("backlog-grip-REEF-1")).toBeInTheDocument();
    expect(screen.getByTestId("backlog-order-mode")).toHaveTextContent(
      "Drag to reorder",
    );
    // The server query should not carry the neutralized planning facets.
    const urls = mockApiFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("sprint_id"))).toBe(false);
    expect(urls.some((u) => u.includes("release_id"))).toBe(false);
  });
});
