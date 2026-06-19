import { WORKFLOW_STATUS_OPTIONS } from "@/components/ui/status-icon";
import { PLANNING_ITEM_PANEL_CLASS } from "@/features/planning/components/PlanningItemCombobox";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";
import {
  FILTER_FIELD_CLASS,
  FilterBar,
  PLANNING_FILTER_WRAPPER_CLASS,
  USER_FILTER_PANEL_CLASS,
} from "./FilterBar";

vi.mock("@/lib/apiClient", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/apiClient")>("@/lib/apiClient");
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("@/features/settings/hooks/useActiveVault", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settings/hooks/useActiveVault")
  >("@/features/settings/hooks/useActiveVault");
  return { ...actual, useActiveVault: vi.fn() };
});

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { apiFetch } from "@/lib/apiClient";

afterEach(cleanup);

beforeEach(() => {
  useIssueStore.setState({
    filter: {},
    searchQuery: "",
    selectedIssueId: null,
  });
  // Default: no workspace selected (the user comboboxes render disabled), and a
  // vault-members lookup that resolves to an empty roster. Individual tests
  // override the vault to exercise the open user dropdown.
  vi.mocked(useActiveVault).mockReturnValue({
    vault: "",
    isLoading: false,
    refetch: vi.fn(),
  });
  vi.mocked(apiFetch).mockResolvedValue(
    new Response(JSON.stringify({ users: [] }), { status: 200 }),
  );
});

function renderFilterBar(props: ComponentProps<typeof FilterBar> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FilterBar {...props} />
    </QueryClientProvider>,
  );
}

describe("FilterBar", () => {
  it("renders all filter controls", () => {
    renderFilterBar();
    expect(screen.getByTestId("status-dropdown-trigger")).toBeTruthy();
    expect(screen.getByTestId("priority-dropdown-trigger")).toBeTruthy();
    expect(screen.getByTestId("dependency-dropdown-trigger")).toBeTruthy();
    expect(screen.getByTestId("assignee-filter")).toBeTruthy();
    expect(screen.getByTestId("requester-filter")).toBeTruthy();
    expect(screen.getByTestId("labels-input")).toBeTruthy();
  });

  it("gives planning filters room to identify long sprint, milestone, and release names", async () => {
    const user = userEvent.setup();
    vi.mocked(useActiveVault).mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: vi.fn(),
    });
    vi.mocked(apiFetch).mockImplementation((input) => {
      const path = String(input);
      if (path.startsWith("/api/planning")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sprints: [],
              milestones: [
                {
                  id: "milestone-1",
                  name: "Autonomous Orchestration & Codex Runner",
                  status: "open",
                  target_date: null,
                },
              ],
              releases: [],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ users: [] }), { status: 200 }),
      );
    });

    renderFilterBar();

    for (const testId of [
      "sprint-filter",
      "milestone-filter",
      "release-filter",
    ]) {
      expect(screen.getByTestId(testId).className).toContain(
        PLANNING_FILTER_WRAPPER_CLASS,
      );
    }
    expect(
      screen.getByTestId("sprint-input").parentElement?.className,
    ).toContain(FILTER_FIELD_CLASS);
    expect(
      screen.getByLabelText("Milestone").parentElement?.className,
    ).toContain(FILTER_FIELD_CLASS);

    await user.click(screen.getByLabelText("Milestone"));
    const panel = screen.getByRole("listbox").parentElement;
    expect(panel?.className).toContain(PLANNING_ITEM_PANEL_CLASS);
  });

  it("selecting a status updates the store", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("status-dropdown-trigger"));
    await user.click(screen.getByTestId("status-option-todo"));
    expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
  });

  it("offers the backlog status by default (list can render it) — REEF-109", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("status-dropdown-trigger"));
    expect(screen.getByTestId("status-option-backlog")).toBeTruthy();
  });

  it("omits backlog when given workflow-only options (board/timeline) — REEF-109", async () => {
    const user = userEvent.setup();
    renderFilterBar({ statusOptions: WORKFLOW_STATUS_OPTIONS });
    await user.click(screen.getByTestId("status-dropdown-trigger"));
    // The workflow set excludes backlog, so the option should not be offered in a
    // view that groups backlog rows away.
    expect(screen.queryByTestId("status-option-backlog")).toBeNull();
    expect(screen.getByTestId("status-option-todo")).toBeTruthy();
  });

  it("renders the backlog's reduced facet set: drops Status/Sprint/Release/Due, keeps Milestone + triage (REEF-109, REEF-177)", () => {
    renderFilterBar({ backlogScope: true });
    // Dropped — the view pins Status, an item in a sprint/release is committed
    // (does not in the backlog), and a Due date on an uncommitted item is
    // contradictory (the view also drops its Due column).
    expect(screen.queryByTestId("status-dropdown-trigger")).toBeNull();
    expect(screen.queryByTestId("sprint-input")).toBeNull();
    expect(screen.queryByTestId("due-dropdown-trigger")).toBeNull();
    expect(screen.queryByLabelText("Release")).toBeNull();
    // Kept — Milestone (a long-horizon theme grooms unscheduled backlog work)
    // plus every triage axis.
    expect(screen.getByLabelText("Milestone")).toBeTruthy();
    expect(screen.getByTestId("type-dropdown-trigger")).toBeTruthy();
    expect(screen.getByTestId("priority-dropdown-trigger")).toBeTruthy();
    expect(screen.getByTestId("severity-dropdown-trigger")).toBeTruthy();
    expect(screen.getByTestId("dependency-dropdown-trigger")).toBeTruthy();
    expect(screen.getByTestId("assignee-filter")).toBeTruthy();
    expect(screen.getByTestId("requester-filter")).toBeTruthy();
    expect(screen.getByTestId("labels-input")).toBeTruthy();
  });

  it("ignores stray status/sprint/release/due values in the backlog active count (REEF-109, REEF-177)", () => {
    // All four hidden-facet values are set in the shared store (e.g. carried over
    // from the list view). The backlog bar hides them and the backlog query
    // neutralizes them, so none may surface a count or a clear button for a
    // control the user does not see.
    useIssueStore.setState({
      filter: {
        status: ["todo"],
        sprint_id: "spr-1",
        release_id: "rel-1",
        due: ["overdue"],
      },
      searchQuery: "",
      selectedIssueId: null,
    });
    renderFilterBar({ backlogScope: true });
    expect(screen.queryByTestId("active-filter-count")).toBeNull();
    expect(screen.queryByTestId("clear-filters-button")).toBeNull();
  });

  it("still counts a kept facet under the backlog carve-out (REEF-177)", () => {
    // A hidden facet (sprint) should not count, but a kept one (priority) should — so
    // the carve-out narrows the count without zeroing real triage filters.
    useIssueStore.setState({
      filter: { sprint_id: "spr-1", priority: ["high"] },
      searchQuery: "",
      selectedIssueId: null,
    });
    renderFilterBar({ backlogScope: true });
    const badge = screen.getByTestId("active-filter-count");
    expect(badge.textContent).toContain("1 filter");
  });

  it("accumulates multiple statuses and drops the facet when emptied (REEF-031)", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("status-dropdown-trigger"));
    await user.click(screen.getByTestId("status-option-todo"));
    await user.click(screen.getByTestId("status-option-in_progress"));
    expect(useIssueStore.getState().filter.status).toEqual([
      "todo",
      "in_progress",
    ]);

    // Unchecking one member leaves the rest.
    await user.click(screen.getByTestId("status-option-todo"));
    expect(useIssueStore.getState().filter.status).toEqual(["in_progress"]);

    // Unchecking the last member drops the facet to undefined (does not []).
    await user.click(screen.getByTestId("status-option-in_progress"));
    expect(useIssueStore.getState().filter.status).toBeUndefined();
  });

  it("selecting a priority updates the store", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("priority-dropdown-trigger"));
    await user.click(screen.getByTestId("priority-option-high"));
    expect(useIssueStore.getState().filter.priority).toEqual(["high"]);
  });

  it("selecting a dependency filter updates the store", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("dependency-dropdown-trigger"));
    await user.click(screen.getByTestId("dependency-option-blocked"));
    expect(useIssueStore.getState().filter.dependencyFilter).toEqual([
      "blocked",
    ]);
  });

  // REEF-072: Due/Dependency options render the shared glyph+label leaf, not a
  // bare string — so they match the Status/Type/Priority/Severity facets. Guard
  // against a regression back to plain text by asserting the option carries a
  // glyph alongside the label.
  it("renders Due options as a glyph+label leaf, not plain text", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("due-dropdown-trigger"));
    for (const [value, label] of [
      ["overdue", "Overdue"],
      ["due_soon", "Due soon"],
    ] as const) {
      const option = screen.getByTestId(`due-option-${value}`);
      expect(within(option).getByText(label)).toBeTruthy();
      expect(option.querySelector("svg")).not.toBeNull();
    }
  });

  it("renders Dependency options as a glyph+label leaf, not plain text", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("dependency-dropdown-trigger"));
    for (const [value, label] of [
      ["blocked", "Blocked"],
      ["blocking", "Blocking"],
    ] as const) {
      const option = screen.getByTestId(`dependency-option-${value}`);
      expect(within(option).getByText(label)).toBeTruthy();
      expect(option.querySelector("svg")).not.toBeNull();
    }
  });

  it("disables the assignee combobox when no vault is configured", () => {
    renderFilterBar();
    const trigger = within(
      screen.getByTestId("assignee-filter"),
    ).getByLabelText("Assignee");
    expect(trigger).toBeDisabled();
  });

  // REEF-134/269: the Assignee/Requester triggers stay narrow (they hug from a
  // `9rem` floor via FILTER_FIELD_CLASS), but the OPEN user dropdown should be
  // wide enough to read a long display name + @login. jsdom does not measure
  // pixels, so assert the structural policy: the opened panel adopts the readable
  // floor (not the default narrow min-width) AND anchors to the start edge so a
  // widened panel on a trigger that wraps to the start of a row grows rightward
  // instead of off the left edge.
  it.each([
    ["assignee-filter", "Assignee"],
    ["requester-filter", "Requester"],
  ] as const)(
    "opens the %s user dropdown with a readable, start-anchored panel (REEF-134)",
    async (testId, label) => {
      const user = userEvent.setup();
      vi.mocked(useActiveVault).mockReturnValue({
        vault: "reef-acme",
        isLoading: false,
        refetch: vi.fn(),
      });
      renderFilterBar();

      const surface = screen.getByTestId(testId);
      await user.click(within(surface).getByLabelText(label));

      const panel = (await within(surface).findByRole("listbox")).parentElement;
      expect(panel?.className).toContain("min-w-[17rem]");
      expect(panel?.className).not.toContain("min-w-[12rem]");
      // Start-anchored (left-0), not right-anchored (right-0): a right-anchored
      // wide panel overflows off-screen-left when the bar wraps (REEF-134).
      expect(panel?.className).toContain("left-0");
      expect(panel?.className).not.toContain("right-0");
    },
  );

  it("shares the same readable user-panel width across both user filters (REEF-134)", () => {
    // Both filters draw from one constant, so the Assignee/Requester dropdowns
    // can not drift apart on width policy.
    expect(USER_FILTER_PANEL_CLASS).toContain("min-w-[17rem]");
  });

  // REEF-269: the six "value field" comboboxes (Assignee · Requester · Sprint ·
  // Milestone · Release · Labels) all draw their width from the single
  // FILTER_FIELD_CLASS token, replacing the pre-REEF-269 mix of fixed `w-36`
  // (people), fit-content capped at `22rem` (planning), and fixed `w-52`
  // (labels). The token lives on each field's width-controlling element: the
  // wrapper for the user + labels fields, the inner combobox root (the trigger's
  // parent) for the planning fields, matching REEF-246's fit-content placement.
  // jsdom can not measure pixels, so this is a class-contract regression guard;
  // the real visual alignment is checked in the hermetic runtime (see the
  // issue's manual-verification note).
  it("sizes every value field from the shared FILTER_FIELD_CLASS token (REEF-269)", () => {
    vi.mocked(useActiveVault).mockReturnValue({
      vault: "reef-acme",
      isLoading: false,
      refetch: vi.fn(),
    });
    renderFilterBar();

    // User + labels fields: the token is on the field wrapper.
    for (const testId of [
      "assignee-filter",
      "requester-filter",
      "labels-filter",
    ]) {
      expect(screen.getByTestId(testId).className).toContain(
        FILTER_FIELD_CLASS,
      );
    }
    // Planning fields: the token is on the inner combobox root (the trigger's
    // parent), per REEF-246's fit-content placement.
    for (const label of ["Sprint", "Milestone", "Release"]) {
      expect(screen.getByLabelText(label).parentElement?.className).toContain(
        FILTER_FIELD_CLASS,
      );
    }
  });

  // REEF-269: the multi-select facet chips are NOT value fields — they keep the
  // auto-width "hug the label" vocabulary (CBX_TRIGGER_CHIP is inline-flex with
  // no width token) and must not adopt the value-field width policy. Nail it down
  // so a future "unify all the comboboxes" pass can't sweep the chips in too.
  it("keeps the facet chips auto-width, not the value-field token (REEF-269)", () => {
    renderFilterBar();
    for (const testId of [
      "status-dropdown-trigger",
      "type-dropdown-trigger",
      "priority-dropdown-trigger",
      "severity-dropdown-trigger",
      "due-dropdown-trigger",
      "dependency-dropdown-trigger",
    ]) {
      const chip = screen.getByTestId(testId);
      expect(chip.className).toContain("inline-flex");
      expect(chip.className).not.toContain("w-fit");
      expect(chip.className).not.toContain("min-w-[9rem]");
      expect(chip.className).not.toContain("w-full");
    }
  });

  it("commits labels with Enter instead of asking for comma-separated text", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    const input = screen.getByTestId("labels-input");
    expect(input.getAttribute("placeholder")).not.toContain("comma");

    await user.type(input, "ui{Enter}");

    expect(useIssueStore.getState().filter.label).toBe("ui");
    expect(screen.getByText("ui")).toBeTruthy();
  });

  // Labels are free-form tokens, not prose — the input suppresses the browser's
  // spellcheck underline and autofill so it reads as tag entry (web interface
  // guidelines: spellcheck off + autocomplete off on non-prose fields).
  it("disables spellcheck and autocomplete on the labels input", () => {
    renderFilterBar();
    const input = screen.getByTestId("labels-input");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("serializes multiple label chips with the existing comma filter contract", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    const input = screen.getByTestId("labels-input");

    await user.type(input, "auth{Enter}infra{Enter}");

    expect(useIssueStore.getState().filter.label).toBe("auth,infra");
  });

  it("shows active filter count badge when filters are active", async () => {
    const user = userEvent.setup();
    renderFilterBar();
    await user.click(screen.getByTestId("status-dropdown-trigger"));
    await user.click(screen.getByTestId("status-option-todo"));
    const badge = screen.getByTestId("active-filter-count");
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("1 filter");
  });

  it("clear filters button resets filter state only (not sort)", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: {
        status: ["todo"],
        priority: ["high"],
        sortField: "created_at",
        sortOrder: "desc",
      },
      searchQuery: "",
      selectedIssueId: null,
    });
    renderFilterBar();
    await user.click(screen.getByTestId("clear-filters-button"));
    const filter = useIssueStore.getState().filter;
    expect(filter.status).toBeUndefined();
    expect(filter.priority).toBeUndefined();
    // Sort is preserved
    expect(filter.sortField).toBe("created_at");
    expect(filter.sortOrder).toBe("desc");
  });

  it("clear filters button is not visible when no filters active", () => {
    renderFilterBar();
    expect(screen.queryByTestId("clear-filters-button")).toBeNull();
  });

  describe("Display options popover (REEF-275)", () => {
    it("toggles Show archived and Show completed from one Display popover", async () => {
      const user = userEvent.setup();
      renderFilterBar();
      // The toggles live behind the Display trigger, not inline on the bar.
      expect(screen.queryByTestId("show-archived-toggle")).toBeNull();
      await user.click(screen.getByTestId("display-options-trigger"));

      await user.click(screen.getByTestId("show-archived-toggle"));
      expect(useIssueStore.getState().filter.showArchived).toBe(true);
      // Panel stays open for the second toggle (not a one-shot menu item).
      await user.click(screen.getByTestId("show-stale-toggle"));
      expect(useIssueStore.getState().filter.showStale).toBe(true);

      // Toggling off drops the flag to undefined so the default URL/persist slot
      // stays bare (mirrors the multi-select facets' empty→undefined rule).
      await user.click(screen.getByTestId("show-archived-toggle"));
      expect(useIssueStore.getState().filter.showArchived).toBeUndefined();
    });

    it("drops the Show completed toggle in the backlog scope — backlog rows are never resolved (REEF-275)", async () => {
      const user = userEvent.setup();
      renderFilterBar({ backlogScope: true });
      await user.click(screen.getByTestId("display-options-trigger"));
      expect(screen.getByTestId("show-archived-toggle")).toBeTruthy();
      expect(screen.queryByTestId("show-stale-toggle")).toBeNull();
    });

    it("marks the Display trigger active when a view-mode toggle is on", () => {
      useIssueStore.setState({
        filter: { showStale: true },
        searchQuery: "",
        selectedIssueId: null,
      });
      renderFilterBar();
      expect(screen.getByTestId("display-options-trigger").className).toContain(
        "border-brand",
      );
    });
  });
});
