import "fake-indexeddb/auto";

import {
  CBX_CHEVRON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "@/components/ui/comboboxChrome";
import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Locale } from "@/i18n/locales";
import { db } from "@/lib/storage/db";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";
import { NamedIssueFilterControl } from "./NamedIssueFilterControl";

vi.mock("@/features/settings/hooks/useActiveVault", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settings/hooks/useActiveVault")
  >("@/features/settings/hooks/useActiveVault");
  return { ...actual, useActiveVault: vi.fn() };
});

afterEach(cleanup);

beforeEach(async () => {
  await db.config.clear();
  useIssueStore.setState({
    filter: {},
    filterVault: "reef-acme",
    searchQuery: "",
    selectedIssueId: null,
  });
  vi.mocked(useActiveVault).mockReturnValue({
    vault: "reef-acme",
    isLoading: false,
    refetch: vi.fn(),
  });
});

function renderControl(locale: Locale = "en") {
  return render(
    <IntlTestProvider locale={locale}>
      <NamedIssueFilterControl />
    </IntlTestProvider>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("named-filter-trigger"));
  return screen.getByTestId("named-filter-menu");
}

async function clickManagementAction(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  action: string,
) {
  await user.click(screen.getByRole("menuitem", { name: `Manage ${name}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}

function expectClassTokens(
  element: HTMLElement | SVGElement,
  className: string,
) {
  for (const token of className.split(/\s+/u).filter(Boolean)) {
    expect(element).toHaveClass(token);
  }
}

describe("NamedIssueFilterControl", () => {
  it("uses the shared inactive chip chrome and chevron", () => {
    renderControl();
    const trigger = screen.getByTestId("named-filter-trigger");

    expectClassTokens(trigger, CBX_TRIGGER_CHIP);
    expectClassTokens(trigger, CBX_TRIGGER_CHIP_INACTIVE);
    expect(trigger).not.toHaveClass("text-xs");
    expect(trigger).not.toHaveClass("text-foreground");
    expect(trigger).not.toHaveClass("border-brand/40");
    expect(screen.queryByTestId("named-filter-active-dot")).toBeNull();
    expect(screen.queryByTestId("named-filter-changed-dot")).toBeNull();

    const chevron = trigger.querySelector("svg");
    expect(chevron).not.toBeNull();
    if (!chevron) return;
    expect(chevron).toHaveClass("lucide-chevron-down");
    expectClassTokens(chevron, CBX_CHEVRON);
    expect(chevron).toHaveAttribute("data-open", "false");
  });

  it("keeps shared active chrome while the named filter becomes changed", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "",
      selectedIssueId: null,
    });
    renderControl();

    await openMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Save current filter…" }),
    );
    await user.type(
      screen.getByTestId("named-filter-name-input"),
      "Triage view",
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    const trigger = screen.getByTestId("named-filter-trigger");
    await waitFor(() => {
      expect(trigger).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Triage view"),
      );
      expect(screen.getByTestId("named-filter-active-dot")).toBeTruthy();
    });
    expectClassTokens(trigger, CBX_TRIGGER_CHIP);
    expectClassTokens(trigger, CBX_TRIGGER_CHIP_ACTIVE);
    expect(trigger).not.toHaveClass("border-brand/40");

    useIssueStore.getState().setFilter({ status: ["in_progress"] });
    await waitFor(() => {
      expect(trigger).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Changed"),
      );
      expect(screen.getByTestId("named-filter-changed-dot")).toBeTruthy();
    });
    expectClassTokens(trigger, CBX_TRIGGER_CHIP_ACTIVE);
    expect(trigger).toHaveClass("bg-brand/10", "ring-1", "ring-brand/30");
    expect(trigger).toHaveClass("text-foreground");
    expect(screen.queryByTestId("named-filter-active-dot")).toBeNull();
    expect(screen.getByTestId("named-filter-changed-dot")).toHaveClass(
      "bg-amber-500",
    );
  });

  it("clears Changed only after a delayed update write settles", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "",
      selectedIssueId: null,
    });
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const originalPut = db.config.put.bind(db.config);
    const putSpy = vi
      .spyOn(db.config, "put")
      .mockImplementation((...args) =>
        Dexie.Promise.resolve(writeGate).then(() => originalPut(...args)),
      );

    try {
      renderControl();
      await openMenu(user);
      await user.click(
        screen.getByRole("menuitem", { name: "Save current filter…" }),
      );
      await user.type(
        screen.getByTestId("named-filter-name-input"),
        "Delayed update view",
      );
      await user.click(screen.getByRole("button", { name: /^Save$/ }));
      const trigger = screen.getByTestId("named-filter-trigger");
      await waitFor(() =>
        expect(trigger).toHaveAttribute(
          "aria-label",
          expect.stringContaining("Delayed update view"),
        ),
      );

      useIssueStore.getState().setFilter({ status: ["in_progress"] });
      await waitFor(() =>
        expect(trigger).toHaveAttribute(
          "aria-label",
          expect.stringContaining("Changed"),
        ),
      );
      await openMenu(user);
      await clickManagementAction(
        user,
        "Delayed update view",
        "Update Delayed update view with the current filter",
      );
      await waitFor(() =>
        expect(trigger).toHaveAttribute(
          "aria-label",
          expect.stringContaining("Changed"),
        ),
      );

      releaseWrite();
      await waitFor(() => {
        expect(trigger).toHaveAttribute(
          "aria-label",
          expect.stringContaining("Active"),
        );
        expect(trigger).not.toHaveAttribute(
          "aria-label",
          expect.stringContaining("Changed"),
        );
      });
    } finally {
      releaseWrite();
      putSpy.mockRestore();
    }
  });

  it("saves, applies, updates, renames, duplicates, and deletes a filter", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: {
        status: ["todo"],
        showArchived: true,
        sortField: "priority",
        sortOrder: "desc",
      },
      filterVault: "reef-acme",
      searchQuery: "one-off",
      selectedIssueId: null,
    });
    const { unmount } = renderControl();

    await openMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Save current filter…" }),
    );
    fireEvent.change(screen.getByTestId("named-filter-name-input"), {
      target: { value: "My triage view" },
    });
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(screen.getByTestId("named-filter-trigger")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("My triage view"),
      ),
    );

    // A reload/remount reads the same browser-local record.
    unmount();
    renderControl();
    const menu = await openMenu(user);
    expect(
      within(menu).getByRole("menuitem", { name: /^My triage view/ }),
    ).toBeTruthy();

    // Applying replaces all saved facets and clears the one-off query.
    useIssueStore.setState({
      filter: { status: ["in_progress"], priority: ["high"] },
      filterVault: "reef-acme",
      searchQuery: "temporary search",
      selectedIssueId: null,
    });
    await user.click(
      within(screen.getByTestId("named-filter-menu")).getByRole("menuitem", {
        name: /^My triage view/,
      }),
    );
    expect(useIssueStore.getState().filter).toMatchObject({
      status: ["todo"],
      showArchived: true,
      sortField: "priority",
      sortOrder: "desc",
    });
    expect(useIssueStore.getState().searchQuery).toBe("");

    // A canonical state change is explicit and update clears it.
    useIssueStore.getState().setFilter({ priority: ["high"] });
    await waitFor(() =>
      expect(screen.getByTestId("named-filter-trigger")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Changed"),
      ),
    );
    await openMenu(user);
    await clickManagementAction(
      user,
      "My triage view",
      "Update My triage view with the current filter",
    );
    await waitFor(() =>
      expect(screen.getByTestId("named-filter-trigger")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Active"),
      ),
    );

    await openMenu(user);
    await clickManagementAction(
      user,
      "My triage view",
      "Rename My triage view",
    );
    const nameInput = screen.getByTestId("named-filter-name-input");
    fireEvent.change(nameInput, { target: { value: "Renamed triage" } });
    await user.click(screen.getByRole("button", { name: /^Rename$/ }));
    await waitFor(() =>
      expect(screen.getByTestId("named-filter-trigger")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Renamed triage"),
      ),
    );

    await openMenu(user);
    await clickManagementAction(
      user,
      "Renamed triage",
      "Duplicate Renamed triage",
    );
    const duplicateInput = screen.getByTestId("named-filter-name-input");
    expect(duplicateInput).toHaveValue("Renamed triage copy");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(screen.queryByTestId("named-filter-dialog")).toBeNull(),
    );

    // A duplicate attempt is rejected without overwriting either record.
    await openMenu(user);
    await clickManagementAction(
      user,
      "Renamed triage",
      "Duplicate Renamed triage",
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A filter with that name already exists.",
    );
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));

    await openMenu(user);
    await clickManagementAction(
      user,
      "Renamed triage copy",
      "Delete Renamed triage copy",
    );
    await user.click(screen.getByTestId("named-filter-confirm-delete"));
    await waitFor(() =>
      expect(screen.queryByTestId("named-filter-delete-dialog")).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("named-filter-trigger")).toHaveFocus(),
    );
    await openMenu(user);
    expect(
      screen.queryByText("Renamed triage copy", { exact: true }),
    ).toBeNull();
  });

  it("returns focus after Escape", async () => {
    const user = userEvent.setup();
    const trigger = renderControl().getByTestId("named-filter-trigger");
    await user.click(trigger);
    expect(screen.getByTestId("named-filter-menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByTestId("named-filter-menu")).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the trigger when Escape closes a dialog opened from the menu", async () => {
    const user = userEvent.setup();
    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        window.setTimeout(() => callback(performance.now()), 0);
        return 0;
      });
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "",
      selectedIssueId: null,
    });
    const trigger = renderControl().getByTestId("named-filter-trigger");

    try {
      await user.click(trigger);
      await user.click(
        screen.getByRole("menuitem", { name: "Save current filter…" }),
      );
      const input = screen.getByTestId("named-filter-name-input");
      input.focus();

      await user.keyboard("{Escape}");
      await waitFor(() => {
        expect(screen.queryByTestId("named-filter-dialog")).toBeNull();
        expect(trigger).toHaveFocus();
      });
    } finally {
      rafSpy.mockRestore();
    }
  });

  it("renders the named-filter surface from the Korean catalog", async () => {
    const user = userEvent.setup();
    renderControl("ko");
    expect(screen.getByTestId("named-filter-trigger")).toHaveAttribute(
      "aria-label",
      "내 필터 메뉴",
    );
    const menu = await openMenu(user);
    expect(menu).toHaveTextContent("저장된 필터가 없습니다.");
  });
});
