import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import type { PlanningCatalog } from "@reef/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLANNING_ITEM_PANEL_CLASS,
  PlanningItemCombobox,
} from "./PlanningItemCombobox";

const SPRINT_ID = "11111111-1111-4111-8111-111111111111";
const LONG_SPRINT_ID = "11111111-1111-4111-8111-111111111113";

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
    {
      id: LONG_SPRINT_ID,
      name: "A planning sprint name that is longer than the compact field width",
      status: "active",
      start_date: "2026-06-26",
      end_date: "2026-07-03",
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

afterEach(cleanup);

function installMeasurementObserver() {
  const previous = globalThis.ResizeObserver;
  const callbacks: Array<() => void> = [];
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(() => callback([], this as unknown as ResizeObserver));
    }

    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  return {
    flush: () => callbacks.forEach((callback) => callback()),
    restore: () => {
      globalThis.ResizeObserver = previous;
    },
  };
}

function setOverflowGeometry(element: Element) {
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: 96 },
    scrollWidth: { configurable: true, value: 360 },
  });
}

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

    const panel = screen.getByRole("listbox").parentElement;
    expect(panel?.className).toContain(PLANNING_ITEM_PANEL_CLASS);
  });

  it("shows overflowing trigger and active option names while preserving planning chrome", async () => {
    const resize = installMeasurementObserver();
    const user = userEvent.setup();
    const longName =
      "A planning sprint name that is longer than the compact field width";

    try {
      render(
        <PlanningItemCombobox
          kind="sprints"
          vault="v"
          value={LONG_SPRINT_ID}
          onChange={() => {}}
          testId="sprint-combo"
        />,
      );

      const trigger = screen.getByTestId("sprint-combo");
      const triggerText = trigger.querySelector("[data-overflow-target]");
      expect(triggerText).not.toBeNull();
      expect(triggerText).toHaveClass("block");
      setOverflowGeometry(triggerText as HTMLElement);
      act(() => resize.flush());
      trigger.focus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(longName);
      expect(trigger).toHaveAttribute("aria-describedby");

      fireEvent.click(trigger);
      const option = screen.getByRole("option", {
        name: /planning sprint name/,
      });
      const optionText = option.querySelector("[data-overflow-target]");
      expect(optionText).not.toBeNull();
      setOverflowGeometry(optionText as HTMLElement);
      act(() => resize.flush());
      expect(await screen.findByRole("tooltip")).toHaveTextContent(longName);
      expect(option.querySelector(".lucide-check")).not.toBeNull();
      expect(option).toHaveTextContent("Active");

      await user.keyboard("{Escape}");
      expect(trigger).toHaveFocus();
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      resize.restore();
    }
  });

  it("does not add an overflow tooltip or description when the trigger fits", async () => {
    const resize = installMeasurementObserver();
    try {
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
      const triggerText = trigger.querySelector("[data-overflow-target]");
      expect(triggerText).not.toBeNull();
      Object.defineProperties(triggerText as HTMLElement, {
        clientWidth: { configurable: true, value: 240 },
        scrollWidth: { configurable: true, value: 96 },
      });
      act(() => resize.flush());
      trigger.focus();
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      expect(trigger).not.toHaveAttribute("aria-describedby");
    } finally {
      resize.restore();
    }
  });
});
