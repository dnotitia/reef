import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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

// The issue list just feeds per-item counts here. Back it with a mutable ref so
// individual tests can vary the linked-issue set (count rendering + delete guard).
const { issuesRef } = vi.hoisted(() => ({
  issuesRef: { current: [] as unknown[] },
}));
vi.mock("@/features/issues/hooks/queries/useIssueList", () => ({
  useIssueList: () => ({ data: issuesRef.current }),
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
    issuesRef.current = [];
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

    await user.click(releasesTab);

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
  // and a `ring-ring` + offset focus ring. It now draws the canonical
  // ViewSwitcher dimensions and the shared `ring-brand` ring from one module.
  // This guards against the outlier classes reappearing.
  it("uses the shared segmented-control dimensions and focus ring (REEF-261)", async () => {
    render(wrap(<PlanningPage />));
    const group = await screen.findByRole("group", { name: "Planning kind" });
    const classes = within(group)
      .getByRole("button", { name: "Sprints" })
      .className.split(/\s+/);
    expect(classes).toContain("text-[12px]");
    expect(classes).toContain("px-2");
    expect(classes).toContain("font-medium");
    expect(classes).toContain("focus-visible:ring-brand");
    // The prior outlier dimensions and focus token are gone.
    expect(classes).not.toContain("text-sm");
    expect(classes).not.toContain("px-3");
    expect(classes).not.toContain("py-1.5");
    expect(classes).not.toContain("focus-visible:ring-ring");
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
    issuesRef.current = [{ sprint_id: SPRINT_ID }, { sprint_id: SPRINT_ID }];
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
