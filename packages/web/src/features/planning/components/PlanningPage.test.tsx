import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, mockReplace, navigationState } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
  navigationState: {
    searchParams: new URLSearchParams(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => navigationState.searchParams,
}));

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/settings/hooks/useActiveVault", () => ({
  useActiveVault: () => ({
    vault: "reef-acme",
    isLoading: false,
    refetch: () => Promise.resolve(),
  }),
}));

// Keep the mocked query state mutable so tests can cover available, failed, and
// successfully retried linked-issue reads without a real network query.
const { issueQueryStateRef } = vi.hoisted(() => ({
  issueQueryStateRef: {
    current: {
      data: [] as unknown[] | undefined,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(() => Promise.resolve()),
    },
  },
}));
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: () => issueQueryStateRef.current,
}));

// Stub the Tiptap editor (jsdom-heavy) with a textarea so planning tests stay
// deterministic — mirrors the pattern in ActivityItemCard.test.tsx. The
// `ariaLabel` becomes the textbox's accessible name for role queries.
vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    placeholder,
    readOnly,
    ariaLabel,
  }: {
    value: string;
    onChange: (markdown: string) => void;
    placeholder?: string;
    readOnly?: boolean;
    ariaLabel?: string;
  }) => (
    <textarea
      data-testid="mock-markdown-editor"
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { apiFetch } from "@/lib/apiClient";
import { PlanningPage } from "./PlanningPage";

const mockApiFetch = vi.mocked(apiFetch);

const SPRINT_ID = "00000000-0000-4000-8000-000000000001";
const MILESTONE_ID = "00000000-0000-4000-8000-000000000001";
const RELEASE_ID = "00000000-0000-4000-8000-000000000001";

const catalog = {
  sprints: [
    {
      id: SPRINT_ID,
      name: "Sprint One",
      status: "active",
      start_date: "2026-06-01",
      end_date: "2026-06-14",
      goal: "Ship the board",
      capacity_points: null,
    },
  ],
  milestones: [
    {
      id: MILESTONE_ID,
      name: "Beta",
      status: "open",
      target_date: null,
      description: "",
    },
  ],
  releases: [
    {
      id: RELEASE_ID,
      name: "v1.0",
      status: "planned",
      target_date: null,
      released_at: null,
      notes: "",
    },
  ],
};

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrap(ui: ReactNode, queryClient = createTestQueryClient()) {
  return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("PlanningPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issueQueryStateRef.current = {
      data: [],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(() => Promise.resolve()),
    };
    navigationState.searchParams = new URLSearchParams();
    mockApiFetch.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.startsWith("/api/planning?")) {
          return Promise.resolve(
            new Response(JSON.stringify(catalog), { status: 200 }),
          );
        }
        if (
          url.startsWith("/api/planning/") &&
          (init?.method === "POST" || init?.method === "PUT")
        ) {
          const body = JSON.parse(String(init.body)) as { item: unknown };
          return Promise.resolve(
            new Response(JSON.stringify({ item: body.item }), { status: 200 }),
          );
        }
        // mutations (create/update/delete) → success
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );
  });

  it("renders status as a labeled badge, not the raw enum value", async () => {
    render(wrap(<PlanningPage />));
    expect(await screen.findByText("Sprint One")).toBeInTheDocument();
    // "active" → "Active" via the planning field registry.
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("renders the shared lifecycle, points, and capacity rollup as one drilldown link", async () => {
    issueQueryStateRef.current.data = [
      { sprint_id: SPRINT_ID, status: "done", estimate_points: 5 },
      { sprint_id: SPRINT_ID, status: "closed", estimate_points: 2 },
      { sprint_id: SPRINT_ID, status: "in_progress", estimate_points: null },
      { sprint_id: SPRINT_ID, status: "in_review", estimate_points: 3 },
      { sprint_id: SPRINT_ID, status: "backlog" },
      { sprint_id: SPRINT_ID, status: "todo", estimate_points: 0 },
    ];

    render(wrap(<PlanningPage />));

    const rollup = await screen.findByTestId(`planning-rollup-${SPRINT_ID}`);
    expect(within(rollup).getByText("6")).toBeInTheDocument();
    expect(within(rollup).getByText("33% complete")).toBeInTheDocument();
    expect(within(rollup).getByText("2 completed")).toBeInTheDocument();
    expect(within(rollup).getByText("2 in progress")).toBeInTheDocument();
    expect(within(rollup).getByText("2 not started")).toBeInTheDocument();
    expect(
      within(rollup).getByText("10 pts total · 7 pts complete"),
    ).toBeInTheDocument();
    expect(within(rollup).getByText("2 unestimated")).toBeInTheDocument();
    expect(within(rollup).getByText("Capacity not set")).toBeInTheDocument();
    expect(rollup).toHaveAttribute(
      "href",
      `/workspace/reef-acme/issues?sprint_id=${SPRINT_ID}`,
    );
    expect(
      within(rollup).getByTestId(`planning-rollup-segments-${SPRINT_ID}`),
    ).toBeInTheDocument();
  });

  it("keeps an available empty item at zero without inventing a completion ratio", async () => {
    render(wrap(<PlanningPage />));

    const rollup = await screen.findByTestId(`planning-rollup-${SPRINT_ID}`);
    expect(within(rollup).getByText("0")).toBeInTheDocument();
    expect(within(rollup).getByText("No completion rate")).toBeInTheDocument();
    expect(rollup).not.toHaveTextContent("0% complete");
  });

  it.each([
    { kind: "sprints", id: SPRINT_ID, filter: "sprint_id" },
    { kind: "milestones", id: MILESTONE_ID, filter: "milestone_id" },
    { kind: "releases", id: RELEASE_ID, filter: "release_id" },
  ] as const)(
    "uses the existing $filter Issues URL contract",
    async ({ kind, id, filter }) => {
      navigationState.searchParams = new URLSearchParams(`kind=${kind}`);
      issueQueryStateRef.current.data = [{ [filter]: id, status: "todo" }];

      render(wrap(<PlanningPage />));

      const rollup = await screen.findByTestId(`planning-rollup-${id}`);
      expect(rollup).toHaveAttribute(
        "href",
        `/workspace/reef-acme/issues?${filter}=${id}`,
      );
    },
  );

  it("distinguishes explicit zero sprint capacity from an unset capacity", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...catalog,
          sprints: [{ ...catalog.sprints[0], capacity_points: 0 }],
        }),
        { status: 200 },
      ),
    );
    issueQueryStateRef.current.data = [
      { sprint_id: SPRINT_ID, status: "todo", estimate_points: 2 },
    ];

    render(wrap(<PlanningPage />));

    const rollup = await screen.findByTestId(`planning-rollup-${SPRINT_ID}`);
    expect(within(rollup).getByText("0 pts capacity")).toBeInTheDocument();
    expect(within(rollup).getByText("2 pts over")).toBeInTheDocument();
    expect(
      within(rollup).queryByText("Capacity not set"),
    ).not.toBeInTheDocument();
  });

  it("uses the shared empty frame and keeps the normal create flow", async () => {
    mockApiFetch.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.startsWith("/api/planning?")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ sprints: [], milestones: [], releases: [] }),
              { status: 200 },
            ),
          );
        }
        if (
          url.startsWith("/api/planning/") &&
          (init?.method === "POST" || init?.method === "PUT")
        ) {
          const body = JSON.parse(String(init.body)) as { item: unknown };
          return Promise.resolve(
            new Response(JSON.stringify({ item: body.item }), { status: 200 }),
          );
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );

    const user = userEvent.setup();
    render(wrap(<PlanningPage />));

    const empty = await screen.findByTestId("planning-empty-sprints");
    expect(
      within(empty).getByRole("heading", { name: "No sprints yet." }),
    ).toBeInTheDocument();
    expect(
      within(empty).getByText("Create a new sprint to start planning."),
    ).toBeInTheDocument();
    expect(empty).toHaveClass(
      "mx-auto",
      "min-h-48",
      "w-full",
      "max-w-4xl",
      "rounded-lg",
      "border-dashed",
      "border-border-subtle",
      "bg-surface-subtle",
      "px-6",
      "py-12",
    );
    expect(within(empty).queryByRole("button")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "New sprint" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByTestId("planning-editor-dialog");
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(
        screen.queryByTestId("planning-editor-dialog"),
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("shows a named catalog error with retry instead of the empty state", async () => {
    mockApiFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "temporary failure" }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(catalog), { status: 200 }),
      );

    const user = userEvent.setup();
    render(wrap(<PlanningPage />));

    const error = await screen.findByTestId("planning-catalog-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(within(error).getByText("Couldn't load planning.")).toBeVisible();
    expect(
      within(error).getByText("Planning items couldn't be loaded. Try again."),
    ).toBeVisible();
    expect(
      screen.queryByTestId("planning-empty-sprints"),
    ).not.toBeInTheDocument();

    await user.click(within(error).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Sprint One")).toBeVisible());
    expect(
      screen.queryByTestId("planning-catalog-error"),
    ).not.toBeInTheDocument();
  });

  it("keeps issue aggregation unavailable and delete fail-closed until retry succeeds", async () => {
    const refetch = vi.fn(() => {
      issueQueryStateRef.current = {
        ...issueQueryStateRef.current,
        data: [],
        isError: false,
        isFetching: false,
      };
      return Promise.resolve();
    });
    issueQueryStateRef.current = {
      data: undefined,
      isPending: false,
      isError: true,
      isFetching: false,
      refetch,
    };

    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const view = render(wrap(<PlanningPage />, queryClient));
    const row = await screen.findByText("Sprint One");
    const tableRow = row.closest("tr") as HTMLElement;
    const issueError = screen.getByTestId("planning-issue-error");
    expect(issueError).toHaveAttribute("role", "alert");
    expect(
      within(issueError).getByText("Couldn't verify linked issues."),
    ).toBeVisible();
    expect(within(tableRow).getByText("Unable to verify")).toBeVisible();

    const deleteButton = within(tableRow).getByRole("button", {
      name: "Delete Sprint One",
    });
    expect(deleteButton).toHaveAttribute("aria-disabled", "true");
    expect(deleteButton).toHaveAttribute(
      "title",
      "Can't delete while linked issues can't be verified",
    );
    expect(deleteButton).toHaveAttribute("aria-describedby");
    deleteButton.focus();
    expect(deleteButton).toHaveFocus();
    expect(
      screen.getByText("Can't delete while linked issues can't be verified"),
    ).toHaveClass("sr-only");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
    view.rerender(wrap(<PlanningPage />, queryClient));
    await waitFor(() => expect(screen.getByText("0")).toBeVisible());
    expect(
      screen.queryByTestId("planning-issue-error"),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByText("Sprint One").closest("tr") as HTMLElement,
      ).getByRole("button", { name: "Delete Sprint One" }),
    ).not.toHaveAttribute("aria-disabled");
  });

  it("does not synthesize rollup values while linked issues are loading", async () => {
    issueQueryStateRef.current = {
      data: undefined,
      isPending: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(() => Promise.resolve()),
    };

    render(wrap(<PlanningPage />));

    const rollup = await screen.findByTestId(`planning-rollup-${SPRINT_ID}`);
    expect(rollup).toHaveTextContent("Loading…");
    expect(rollup).not.toHaveTextContent("0");
    expect(rollup).not.toHaveAttribute("href");
  });

  it("renders sprint dates via the shared DateDisplay", async () => {
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");
    // DateDisplay "iso" format → bare YYYY-MM-DD, as the issue list cells do.
    // The sprint range packs both dates into one cell, so assert on the row's
    // text rather than a single element (an Intl swap or dropped column fails).
    const row = screen.getByText("Sprint One").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("2026-06-01");
    expect(row.textContent).toContain("2026-06-14");
  });

  it("restores the planning kind from the URL and writes kind changes back", async () => {
    navigationState.searchParams = new URLSearchParams("kind=milestones&foo=1");
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Beta");

    const group = screen.getByRole("group", { name: "Planning kind" });
    const sprintsTab = within(group).getByRole("button", { name: "Sprints" });
    const milestonesTab = within(group).getByRole("button", {
      name: "Milestones",
    });
    const releasesTab = within(group).getByRole("button", { name: "Releases" });
    expect(sprintsTab).toHaveAttribute("aria-pressed", "false");
    expect(milestonesTab).toHaveAttribute("aria-pressed", "true");

    releasesTab.focus();
    await user.keyboard(" ");

    expect(mockPush).toHaveBeenCalledTimes(1);
    const [url, opts] = mockPush.mock.calls[0];
    const params = new URLSearchParams((url as string).split("?")[1]);
    expect((url as string).startsWith("/workspace/reef-acme/planning?")).toBe(
      true,
    );
    expect(params.get("kind")).toBe("releases");
    expect(params.get("foo")).toBe("1");
    expect(params.has("detail")).toBe(false);
    expect(opts).toEqual({ scroll: false });
  });

  // REEF-261: the kind toggle was the family outlier — `text-sm`, `px-3 py-1.5`,
  // and a `ring-focus-ring` + offset focus ring. It now draws the canonical
  // ViewSwitcher dimensions and the shared `ring-brand-focus` ring from one module.
  // This guards against the outlier classes reappearing.
  it("uses the shared segmented-control dimensions and focus ring (REEF-261)", async () => {
    render(wrap(<PlanningPage />));
    const group = await screen.findByRole("group", { name: "Planning kind" });
    const classes = within(group)
      .getByRole("button", { name: "Sprints" })
      .className.split(/\s+/);
    expect(classes).toContain("type-control");
    expect(classes).toContain("px-2");
    expect(classes).toContain("font-medium");
    expect(classes).toContain("focus-visible:ring-brand-focus");
    // The prior outlier dimensions and focus token are gone.
    expect(classes).not.toContain("text-sm");
    expect(classes).not.toContain("px-3");
    expect(classes).not.toContain("py-1.5");
    expect(classes).not.toContain("focus-visible:ring-focus-ring");
    expect(classes).not.toContain("focus-visible:ring-offset-1");
  });

  it("keeps Save enabled and validates a missing name inline", async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    const dialog = await screen.findByTestId("planning-editor-dialog");

    // Status <Select> is wired to its label via aria-labelledby (EnumSelectField).
    expect(
      within(dialog).getByRole("combobox", { name: "Status" }),
    ).toBeInTheDocument();

    const save = within(dialog).getByTestId("planning-save");
    expect(save).toBeEnabled();

    await user.click(save);
    const nameInput = within(dialog).getByTestId("planning-name-input");
    expect(
      await within(dialog).findByText("Name is required."),
    ).toHaveAttribute("role", "alert");
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveFocus();

    await user.type(nameInput, "Q3");
    expect(
      within(dialog).queryByText("Name is required."),
    ).not.toBeInTheDocument();
  });

  it("exposes busy semantics while creating a planning item", async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    const createResponse = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });
    mockApiFetch.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url.startsWith("/api/planning?")) {
          return Promise.resolve(
            new Response(JSON.stringify(catalog), { status: 200 }),
          );
        }
        if (init?.method === "POST") return createResponse;
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );

    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");
    await user.click(screen.getByRole("button", { name: "New sprint" }));
    const dialog = await screen.findByTestId("planning-editor-dialog");
    await user.type(within(dialog).getByTestId("planning-name-input"), "Q3");
    const save = within(dialog).getByTestId("planning-save");

    await user.click(save);

    await waitFor(() => {
      expect(save).toBeDisabled();
      expect(save).toHaveAttribute("aria-busy", "true");
      expect(save).toHaveTextContent("Saving…");
    });

    resolveCreate?.(
      new Response(
        JSON.stringify({
          item: {
            id: "00000000-0000-4000-8000-000000000002",
            name: "Q3",
            status: "planned",
            start_date: null,
            end_date: null,
            goal: "",
            capacity_points: null,
          },
        }),
        { status: 200 },
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByTestId("planning-editor-dialog"),
      ).not.toBeInTheDocument(),
    );
  });

  it("confirms deletion with a dialog (not window.confirm) and issues the DELETE", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    await user.click(screen.getByRole("button", { name: "Delete Sprint One" }));

    const dialog = await screen.findByTestId("planning-delete-confirm");
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByTestId("planning-delete-confirm-btn"));

    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/planning/sprints/"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("returns focus to the invoking delete action when cancellation closes the dialog", async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    const trigger = screen.getByRole("button", { name: "Delete Sprint One" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const dialog = await screen.findByTestId("planning-delete-confirm");
    const cancel = within(dialog).getByTestId("planning-delete-cancel");
    cancel.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(
        screen.queryByTestId("planning-delete-confirm"),
      ).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("keeps planning metadata and row actions available in the compact presentation", async () => {
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: true,
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );
    issueQueryStateRef.current.data = [
      { sprint_id: SPRINT_ID, status: "done", estimate_points: 5 },
    ];
    const view = render(wrap(<PlanningPage />));

    try {
      const compact = await screen.findByTestId("planning-compact-list");
      expect(compact).toHaveTextContent("Sprint One");
      expect(compact).toHaveTextContent("Active");
      expect(compact).toHaveTextContent("2026-06-01");
      expect(compact).toHaveTextContent("2026-06-14");
      const rollup = within(compact).getByTestId(
        `planning-rollup-${SPRINT_ID}`,
      );
      expect(rollup).toHaveTextContent("100% complete");
      expect(rollup).toHaveTextContent("1 completed");
      expect(rollup).toHaveAttribute(
        "href",
        `/workspace/reef-acme/issues?sprint_id=${SPRINT_ID}`,
      );
      expect(
        within(compact).getByRole("button", { name: "Edit Sprint One" }),
      ).toBeInTheDocument();
      expect(
        within(compact).getByRole("button", { name: "Delete Sprint One" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
    } finally {
      view.unmount();
      matchMedia.mockRestore();
    }
  });

  it("saves an open editor against its original kind after URL kind changes", async () => {
    navigationState.searchParams = new URLSearchParams("kind=milestones");
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const { rerender } = render(wrap(<PlanningPage />, queryClient));
    await screen.findByText("Beta");

    await user.click(screen.getByRole("button", { name: "Edit Beta" }));
    const dialog = await screen.findByTestId("planning-editor-dialog");

    navigationState.searchParams = new URLSearchParams();
    rerender(wrap(<PlanningPage />, queryClient));
    await user.click(within(dialog).getByTestId("planning-save"));

    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/planning/milestones/${MILESTONE_ID}`,
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });

  it("deletes the selected original kind after URL kind changes", async () => {
    navigationState.searchParams = new URLSearchParams("kind=milestones");
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const { rerender } = render(wrap(<PlanningPage />, queryClient));
    await screen.findByText("Beta");

    await user.click(screen.getByRole("button", { name: "Delete Beta" }));
    const dialog = await screen.findByTestId("planning-delete-confirm");

    navigationState.searchParams = new URLSearchParams();
    rerender(wrap(<PlanningPage />, queryClient));
    await user.click(within(dialog).getByTestId("planning-delete-confirm-btn"));

    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/planning/milestones/${MILESTONE_ID}`),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("renders the linked-issue count and disables delete for a linked item", async () => {
    issueQueryStateRef.current.data = [
      { sprint_id: SPRINT_ID, status: "todo" },
      { sprint_id: SPRINT_ID, status: "done" },
    ];
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    const row = screen.getByText("Sprint One").closest("tr");
    expect(row).not.toBeNull();
    const rowScope = within(row as HTMLElement);
    expect(rowScope.getByText("2")).toBeInTheDocument();
    expect(
      rowScope.getByRole("button", { name: "Delete Sprint One" }),
    ).toBeDisabled();
  });

  it("edits planning notes with a markdown editor and a contextual placeholder", async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    await user.click(screen.getByRole("button", { name: /new sprint/i }));
    const dialog = await screen.findByTestId("planning-editor-dialog");

    // The Goal body is the markdown editor (aria-label "Goal"), not a plain
    // textarea, and carries the sprint-specific placeholder.
    const goal = within(dialog).getByRole("textbox", { name: "Goal" });
    expect(goal).toHaveAttribute("placeholder", "Describe the sprint goal…");
  });

  it.each([
    { kind: "", rowName: "Sprint One", editName: "Edit Sprint One", dates: 2 },
    { kind: "milestones", rowName: "Beta", editName: "Edit Beta", dates: 1 },
    { kind: "releases", rowName: "v1.0", editName: "Edit v1.0", dates: 2 },
  ])(
    "uses the themed date picker and issue-style dialog policy for $rowName",
    async ({ kind, rowName, editName, dates }) => {
      if (kind) {
        navigationState.searchParams = new URLSearchParams(`kind=${kind}`);
      }
      const user = userEvent.setup();
      render(wrap(<PlanningPage />));
      await screen.findByText(rowName);

      await user.click(screen.getByRole("button", { name: editName }));
      const dialog = await screen.findByTestId("planning-editor-dialog");

      expect(dialog).toHaveClass("max-h-[88vh]", "max-w-3xl");
      expect(
        within(dialog).queryByRole("button", { name: "Close" }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();
      expect(dialog.querySelector('input[type="date"]')).toBeNull();
      expect(within(dialog).getAllByTestId("date-picker-trigger")).toHaveLength(
        dates,
      );
    },
  );

  it("clears planning dates through the shared picker before saving", async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    await user.click(screen.getByRole("button", { name: "Edit Sprint One" }));
    const dialog = await screen.findByTestId("planning-editor-dialog");

    await user.click(within(dialog).getByLabelText("Clear Start"));
    await user.click(within(dialog).getByTestId("planning-save"));

    await vi.waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/planning/sprints/${SPRINT_ID}`,
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"start_date":null'),
        }),
      );
    });
  });

  it("expands a row to render the body as markdown and toggles aria-expanded", async () => {
    navigationState.searchParams = new URLSearchParams(`detail=${SPRINT_ID}`);
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    const expand = screen.getByRole("button", {
      name: "Collapse Sprint One details",
    });
    expect(expand).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("textbox", { name: "Sprint One details" }),
    ).toHaveValue("Ship the board");

    await user.click(expand);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [url, opts] = mockReplace.mock.calls[0];
    expect(url).toBe("/workspace/reef-acme/planning");
    expect(opts).toEqual({ scroll: false });
  });

  it("writes expanded row state to the URL", async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    await user.click(
      screen.getByRole("button", { name: "Expand Sprint One details" }),
    );

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [url, opts] = mockReplace.mock.calls[0];
    const params = new URLSearchParams((url as string).split("?")[1]);
    expect((url as string).startsWith("/workspace/reef-acme/planning?")).toBe(
      true,
    );
    expect(params.get("detail")).toBe(SPRINT_ID);
    expect(opts).toEqual({ scroll: false });
  });

  it("toggles by clicking the title, with a single disclosure control (REEF-264)", async () => {
    const user = userEvent.setup();
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    const title = screen.getByText("Sprint One");
    const row = title.closest("tr") as HTMLElement;
    // AC2: chevron + title are one button — exactly one aria-expanded toggle in
    // the row (Edit/Delete carry no aria-expanded), not two disclosure controls.
    expect(
      within(row).getAllByRole("button", { expanded: false }),
    ).toHaveLength(1);
    // AC1: the title text itself lives inside that single disclosure button.
    expect(title.closest("button")).toHaveAttribute("aria-expanded", "false");

    // AC1: clicking the title (not just the 20px chevron) toggles the panel.
    await user.click(title);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const [url] = mockReplace.mock.calls[0];
    const params = new URLSearchParams((url as string).split("?")[1]);
    expect(params.get("detail")).toBe(SPRINT_ID);
  });

  it("keeps adjacent table-row actions explicitly compact", async () => {
    render(wrap(<PlanningPage />));
    await screen.findByText("Sprint One");

    const row = screen.getByText("Sprint One").closest("tr") as HTMLElement;
    for (const name of ["Edit Sprint One", "Delete Sprint One"]) {
      expect(within(row).getByRole("button", { name })).not.toHaveClass(
        "[@media(pointer:coarse)]:min-w-11",
      );
      expect(within(row).getByRole("button", { name })).toHaveClass("h-7");
    }
  });

  it("renders a row without a detail body as plain text, not a toggle (REEF-264)", async () => {
    navigationState.searchParams = new URLSearchParams("kind=milestones");
    render(wrap(<PlanningPage />));
    await screen.findByText("Beta");

    // AC3: Beta has no description, so its name stays plain text on the spacer
    // branch — not a dead button — and the row exposes no aria-expanded control.
    const title = screen.getByText("Beta");
    expect(title.closest("button")).toBeNull();
    const row = title.closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { expanded: true })).toBeNull();
    expect(within(row).queryByRole("button", { expanded: false })).toBeNull();
  });
});
