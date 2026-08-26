import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { PlanningCatalog } from "@reef/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLANNING_ITEM_PANEL_CLASS,
  PlanningItemCombobox,
} from "./PlanningItemCombobox";

const SPRINT_ID = "11111111-1111-4111-8111-111111111111";

const catalog: PlanningCatalog = {
  sprints: [
    {
      id: SPRINT_ID,
      name: "Sprint 3",
      status: "active",
      start_date: "2026-06-12",
      end_date: "2026-06-19",
      goal: "",
      capacity_points: null,
    },
    {
      id: "11111111-1111-4111-8111-111111111112",
      name: "Sprint 4",
      status: "planned",
      start_date: "2026-06-19",
      end_date: "2026-06-26",
      goal: "",
      capacity_points: null,
    },
  ],
  milestones: [],
  releases: [],
};

vi.mock("../hooks/usePlanningCatalog", () => ({
  usePlanningCatalog: () => ({ data: catalog, isPending: false }),
}));

const ORIGINAL_SPRINT_NAME = catalog.sprints[0].name;

afterEach(() => {
  catalog.sprints[0].name = ORIGINAL_SPRINT_NAME;
  cleanup();
});

// lucide tags each glyph with `lucide-<name>`; the sprint kind glyph is
// `iteration-cw`, so we can assert its presence/absence precisely.
const SPRINT_GLYPH = ".lucide-iteration-cw";

describe("PlanningItemCombobox", () => {
  // The combobox is a plain value control, like every other field combobox
  // (Type/Status/Priority/Assignee). The planning-kind glyph lives just where it
  // doesn't duplicate a text identifier: the planning page kind tabs (an icon
  // segmented control, mirroring ViewSwitcher) and the board card strip (a
  // label-less compact value display). It is NOT rendered on the combobox, the
  // create/edit/detail field labels, or the list column headers — those already
  // read as text — so create/edit does not show the mark twice and no single
  // combobox is special.
  it("keeps the trigger plain — no kind glyph on the selected value", () => {
    render(
      <PlanningItemCombobox
        kind="sprints"
        vault="v"
        value={SPRINT_ID}
        onChange={() => {}}
        testId="sprint-combo"
      />,
    );

    const trigger = screen.getByTestId("sprint-combo");
    expect(trigger.textContent).toContain("Sprint 3");
    expect(trigger.querySelector(SPRINT_GLYPH)).toBeNull();
  });

  it("keeps the trigger plain in the placeholder state too (filters)", () => {
    render(
      <PlanningItemCombobox
        kind="sprints"
        vault="v"
        value=""
        onChange={() => {}}
        placeholder="Sprint"
        testId="sprint-filter"
      />,
    );

    const trigger = screen.getByTestId("sprint-filter");
    expect(trigger.textContent).toContain("Sprint");
    expect(trigger.querySelector(SPRINT_GLYPH)).toBeNull();
  });

  it("carries no kind glyph on option rows either", () => {
    render(
      <PlanningItemCombobox
        kind="sprints"
        vault="v"
        value={SPRINT_ID}
        onChange={() => {}}
        testId="sprint-combo"
      />,
    );

    fireEvent.click(screen.getByTestId("sprint-combo"));

    const listbox = screen.getByRole("listbox");
    expect(listbox.textContent).toContain("Sprint 4");
    expect(listbox.querySelector(SPRINT_GLYPH)).toBeNull();
  });

  it("localizes the placeholder wrapper in ko without an English prefix (REEF-309)", () => {
    render(
      <IntlTestProvider locale="ko">
        <PlanningItemCombobox
          kind="sprints"
          vault="v"
          value=""
          onChange={() => {}}
          testId="sprint-combo"
        />
      </IntlTestProvider>,
    );

    // The "{kind} 선택" wrapper is catalog-owned; the old assembled
    // `Select ${singular}` leaked "Select 스프린트" in ko.
    const trigger = screen.getByTestId("sprint-combo");
    expect(trigger.textContent).toContain("선택");
    expect(trigger.textContent).not.toContain("Select");
  });

  it("opens planning lists with a readable panel width floor", () => {
    render(
      <PlanningItemCombobox
        kind="sprints"
        vault="v"
        value=""
        onChange={() => {}}
        testId="sprint-combo"
      />,
    );

    fireEvent.click(screen.getByTestId("sprint-combo"));

    const panel = screen.getByRole("listbox").closest('[role="dialog"]');
    expect(panel?.className).toContain(PLANNING_ITEM_PANEL_CLASS);
  });

  it("reveals an overflowing planning name on trigger hover and active option", async () => {
    const user = userEvent.setup();
    const longName =
      "A planning sprint name that is longer than a compact selector can display";
    catalog.sprints[0].name = longName;

    render(
      <PlanningItemCombobox
        kind="sprints"
        vault="v"
        value={SPRINT_ID}
        onChange={() => {}}
        testId="sprint-combo"
      />,
    );

    const triggerName = screen.getByText(longName);
    Object.defineProperty(triggerName, "clientWidth", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(triggerName, "scrollWidth", {
      configurable: true,
      value: 360,
    });
    await act(async () => {
      fireEvent(window, new Event("resize"));
    });
    const measuredTrigger = screen.getByTestId("sprint-combo");

    await user.hover(measuredTrigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(longName);
    await user.unhover(measuredTrigger);
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );

    await user.click(measuredTrigger);
    await user.unhover(screen.getByTestId("sprint-combo"));
    const option = screen.getByRole("option", { name: new RegExp(longName) });
    await user.hover(option);
    const optionName = option.querySelector("span.truncate") as HTMLElement;
    Object.defineProperty(optionName, "clientWidth", {
      configurable: true,
      value: 96,
    });
    Object.defineProperty(optionName, "scrollWidth", {
      configurable: true,
      value: 360,
    });
    await act(async () => {
      fireEvent(window, new Event("resize"));
    });

    expect(await screen.findByRole("tooltip")).toHaveTextContent(longName);
  });

  it("does not create a tooltip when a planning name fits", async () => {
    const user = userEvent.setup();
    render(
      <PlanningItemCombobox
        kind="sprints"
        vault="v"
        value={SPRINT_ID}
        onChange={() => {}}
        testId="sprint-combo"
      />,
    );

    const trigger = screen.getByTestId("sprint-combo");
    const triggerName = screen.getByText("Sprint 3");
    Object.defineProperty(triggerName, "clientWidth", {
      configurable: true,
      value: 240,
    });
    Object.defineProperty(triggerName, "scrollWidth", {
      configurable: true,
      value: 120,
    });
    await act(async () => {
      fireEvent(window, new Event("resize"));
    });

    await user.hover(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
