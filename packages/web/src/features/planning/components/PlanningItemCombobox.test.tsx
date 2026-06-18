import type { PlanningCatalog } from "@reef/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(cleanup);

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
});
