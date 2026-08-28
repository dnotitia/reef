import "fake-indexeddb/auto";

import { useActiveVault } from "@/features/settings/hooks/useActiveVault";
import { useCurrentUserLogin } from "@/features/auth/hooks/useCurrentUserLogin";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIssueStore } from "../../stores/useIssueStore";
import { MyViewControl } from "./MyViewControl";

vi.mock("@/features/settings/hooks/useActiveVault", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/settings/hooks/useActiveVault")
  >("@/features/settings/hooks/useActiveVault");
  return { ...actual, useActiveVault: vi.fn() };
});

vi.mock("@/features/auth/hooks/useCurrentUserLogin", () => ({
  useCurrentUserLogin: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db.config.clear();
  useIssueStore.setState({
    filter: {},
    filterVault: "reef-acme",
    searchQuery: "",
    selectedIssueId: null,
    listOptionalColumns: [],
  });
  vi.mocked(useActiveVault).mockReturnValue({
    vault: "reef-acme",
    isLoading: false,
    refetch: vi.fn(),
  });
  vi.mocked(useCurrentUserLogin).mockReturnValue("alice");
});

function renderControl(
  locale: Locale = "en",
  props: Partial<React.ComponentProps<typeof MyViewControl>> = {},
) {
  return render(
    <IntlTestProvider locale={locale}>
      <MyViewControl scope="active" layout="list" groupBy="none" {...props} />
    </IntlTestProvider>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("my-view-trigger"));
  return screen.getByTestId("my-view-menu");
}

async function createView(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await openMenu(user);
  await user.click(
    screen.getByRole("menuitem", { name: "Save current view…" }),
  );
  await user.type(screen.getByTestId("my-view-name-input"), name);
  await user.click(screen.getByRole("button", { name: /^Save$/ }));
  await waitFor(() =>
    expect(screen.getByTestId("my-view-trigger")).toHaveAttribute(
      "aria-label",
      expect.stringContaining(name),
    ),
  );
}

describe("MyViewControl", () => {
  it("uses the shared inactive chip chrome and exposes My Views", () => {
    renderControl();
    const trigger = screen.getByTestId("my-view-trigger");
    expect(trigger).toHaveAttribute("aria-label", "My Views menu");
    expect(trigger).toHaveTextContent("My Views");
  });

  it("saves, applies, marks changed, updates, renames, duplicates, and deletes a view", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: { status: ["todo"], showArchived: true },
      filterVault: "reef-acme",
      searchQuery: "temporary",
      selectedIssueId: null,
      listOptionalColumns: ["start"],
    });
    renderControl();

    await createView(user, "My triage view");
    const trigger = screen.getByTestId("my-view-trigger");
    await waitFor(() => {
      expect(trigger).toHaveAttribute(
        "aria-label",
        expect.stringContaining("My triage view"),
      );
      expect(screen.getByTestId("my-view-active-dot")).toBeInTheDocument();
    });

    useIssueStore.getState().setFilter({ priority: ["high"] });
    await waitFor(() => {
      expect(trigger).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Changed"),
      );
      expect(screen.getByTestId("my-view-changed-dot")).toBeInTheDocument();
    });

    let menu = await openMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", {
        name: "Update My triage view with the current view",
      }),
    );
    await waitFor(() =>
      expect(trigger).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Active"),
      ),
    );

    menu = await openMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", {
        name: "Rename My triage view",
      }),
    );
    await user.clear(screen.getByTestId("my-view-name-input"));
    await user.type(screen.getByTestId("my-view-name-input"), "Renamed view");
    await user.click(screen.getByRole("button", { name: /^Rename$/ }));
    await waitFor(() =>
      expect(trigger).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Renamed view"),
      ),
    );

    menu = await openMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", {
        name: "Duplicate Renamed view",
      }),
    );
    expect(screen.getByTestId("my-view-name-input")).toHaveValue(
      "Renamed view copy",
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() =>
      expect(screen.queryByTestId("my-view-dialog")).not.toBeInTheDocument(),
    );

    menu = await openMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", {
        name: "Delete Renamed view copy",
      }),
    );
    await user.click(screen.getByTestId("my-view-confirm-delete"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("my-view-delete-dialog"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("rejects duplicate names without replacing the existing view", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: { status: ["todo"] },
      filterVault: "reef-acme",
      searchQuery: "",
      selectedIssueId: null,
      listOptionalColumns: [],
    });
    renderControl();
    await createView(user, "Triage");

    const menu = await openMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", {
        name: "Duplicate Triage",
      }),
    );
    await user.clear(screen.getByTestId("my-view-name-input"));
    await user.type(screen.getByTestId("my-view-name-input"), " triage ");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A My View with that name already exists.",
    );
  });

  it("applies the complete snapshot and clears one-off search", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: { status: ["in_progress"] },
      filterVault: "reef-acme",
      searchQuery: "temporary",
      selectedIssueId: null,
      listOptionalColumns: [],
    });
    renderControl("en", {
      scope: "backlog",
      layout: "list",
      groupBy: "priority",
      listOptionalColumns: ["start"],
    });
    await createView(user, "Backlog triage");

    useIssueStore.setState({
      filter: { priority: ["low"] },
      searchQuery: "another",
      listOptionalColumns: [],
    });
    const menu = await openMenu(user);
    await user.click(
      within(menu).getByRole("menuitem", {
        name: /^Backlog triage/,
      }),
    );
    expect(useIssueStore.getState().filter).toMatchObject({
      status: ["in_progress"],
      orderingMode: "manual",
    });
    expect(useIssueStore.getState().searchQuery).toBe("");
    expect(useIssueStore.getState().listOptionalColumns).toEqual(["start"]);
  });

  it("returns focus after Escape and uses the Korean catalog", async () => {
    const user = userEvent.setup();
    const { getByTestId } = renderControl("ko");
    const trigger = getByTestId("my-view-trigger");
    await user.click(trigger);
    expect(screen.getByTestId("my-view-menu")).toHaveTextContent(
      "저장된 My View가 없습니다.",
    );
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows a storage load failure without disabling issue browsing", async () => {
    vi.spyOn(db.config, "where").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    renderControl();
    await userEvent.setup().click(screen.getByTestId("my-view-trigger"));
    expect(screen.getByTestId("my-view-menu")).toHaveTextContent(
      "My Views could not be loaded.",
    );
  });
});
