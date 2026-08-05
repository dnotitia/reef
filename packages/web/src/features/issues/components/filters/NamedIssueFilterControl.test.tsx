import "fake-indexeddb/auto";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { Locale } from "@/i18n/locales";
import { db } from "@/lib/storage/db";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("NamedIssueFilterControl", () => {
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
    await user.type(
      screen.getByTestId("named-filter-name-input"),
      "My triage view",
    );
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
    await user.click(
      screen.getByRole("menuitem", {
        name: "Update My triage view with the current filter",
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("named-filter-trigger")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Active"),
      ),
    );

    await openMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Rename My triage view" }),
    );
    const nameInput = screen.getByTestId("named-filter-name-input");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed triage");
    await user.click(screen.getByRole("button", { name: /^Rename$/ }));
    await waitFor(() =>
      expect(screen.getByTestId("named-filter-trigger")).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Renamed triage"),
      ),
    );

    await openMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Duplicate Renamed triage" }),
    );
    const duplicateInput = screen.getByTestId("named-filter-name-input");
    expect(duplicateInput).toHaveValue("Renamed triage copy");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(screen.queryByTestId("named-filter-dialog")).toBeNull(),
    );

    // A duplicate attempt is rejected without overwriting either record.
    await openMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Duplicate Renamed triage" }),
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A filter with that name already exists.",
    );
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));

    await openMenu(user);
    await user.click(
      screen.getByRole("menuitem", { name: "Delete Renamed triage copy" }),
    );
    await user.click(screen.getByTestId("named-filter-confirm-delete"));
    await waitFor(() =>
      expect(screen.queryByTestId("named-filter-delete-dialog")).toBeNull(),
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
