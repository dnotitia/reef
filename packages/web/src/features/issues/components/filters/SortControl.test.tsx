import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CBX_CHEVRON,
  CBX_TRIGGER_CHIP,
  CBX_TRIGGER_CHIP_ACTIVE,
  CBX_TRIGGER_CHIP_INACTIVE,
} from "@/components/ui/comboboxChrome";
import { IntlTestProvider } from "@/i18n/i18n.testSupport";
import { useIssueStore } from "../../stores/useIssueStore";
import { SortControl } from "./SortControl";

afterEach(cleanup);

beforeEach(() => {
  useIssueStore.setState({
    filter: {},
    searchQuery: "",
    selectedIssueId: null,
  });
});

describe("SortControl", () => {
  it("uses the shared filter chip chrome and exposes chevron state", async () => {
    const user = userEvent.setup();
    render(<SortControl />);

    const trigger = screen.getByTestId("sort-control-trigger");
    expect(trigger.className).toContain(CBX_TRIGGER_CHIP);
    expect(trigger.className).toContain(CBX_TRIGGER_CHIP_INACTIVE);
    expect(screen.getByTestId("sort-control")).not.toHaveClass(
      "border-brand-focus",
    );

    const chevron = trigger.querySelector("svg.lucide-chevron-down");
    expect(chevron).not.toBeNull();
    expect(chevron).toHaveAttribute("data-open", "false");
    if (chevron) {
      for (const token of CBX_CHEVRON.split(/\s+/u).filter(Boolean)) {
        expect(chevron).toHaveClass(token);
      }
    }

    await user.click(trigger);
    expect(
      screen
        .getByTestId("sort-control-trigger")
        .querySelector("svg.lucide-chevron-down"),
    ).toHaveAttribute("data-open", "true");
  });

  it("marks explicit sorting active across the split control", () => {
    useIssueStore.setState({
      filter: { sortField: "priority", sortOrder: "desc" },
    });
    render(<SortControl />);

    const trigger = screen.getByTestId("sort-control-trigger");
    expect(trigger.className).toContain(CBX_TRIGGER_CHIP);
    expect(trigger.className).toContain(CBX_TRIGGER_CHIP_ACTIVE);
    expect(screen.getByTestId("sort-direction-toggle")).toHaveClass(
      "border-brand-focus",
      "bg-brand-fill/10",
      "ring-1",
      "ring-brand-focus/30",
    );
  });

  it("names the current direction in the button label and tooltip", () => {
    useIssueStore.setState({
      filter: { sortField: "priority", sortOrder: "desc" },
    });
    render(<SortControl />);

    const direction = screen.getByTestId("sort-direction-toggle");
    expect(direction).toHaveAttribute(
      "aria-label",
      expect.stringContaining("High → Low"),
    );
    expect(direction).toHaveAttribute("title", "Direction: High → Low");
  });

  it("shows the current direction in a visible tooltip on hover and focus", async () => {
    const user = userEvent.setup();
    useIssueStore.setState({
      filter: { sortField: "priority", sortOrder: "desc" },
    });
    render(<SortControl />);

    const direction = screen.getByTestId("sort-direction-toggle");
    fireEvent.pointerMove(direction, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Direction: High → Low",
    );

    await user.unhover(direction);
    direction.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Direction: High → Low",
    );

    await user.keyboard("{Enter}");
    expect(direction).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Low → High"),
    );
    expect(direction).toHaveAttribute("title", "Direction: Low → High");
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Direction: Low → High",
    );

    fireEvent.blur(direction);
    fireEvent.pointerMove(direction, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Direction: Low → High",
    );
  });

  it("shows the pristine default (Priority · High → Low) without writing it to the store", () => {
    render(<SortControl />);
    const trigger = screen.getByTestId("sort-control-trigger");
    expect(trigger.textContent).toContain("Priority");
    expect(trigger.textContent).toContain("High → Low");
    // REEF-057: the implicit default should not leak into the store.
    expect(useIssueStore.getState().filter.sortField).toBeUndefined();
  });

  it("selecting a field writes it with its natural direction", async () => {
    const user = userEvent.setup();
    render(<SortControl />);
    await user.click(screen.getByTestId("sort-control-trigger"));
    await user.click(screen.getByTestId("sort-option-due_date"));
    const { sortField, sortOrder } = useIssueStore.getState().filter;
    expect(sortField).toBe("due_date");
    expect(sortOrder).toBe("asc"); // naturalSortOrder(due_date) → soonest
  });

  it("selecting title lands on A→Z (asc)", async () => {
    const user = userEvent.setup();
    render(<SortControl />);
    await user.click(screen.getByTestId("sort-control-trigger"));
    await user.click(screen.getByTestId("sort-option-title"));
    expect(useIssueStore.getState().filter.sortField).toBe("title");
    expect(useIssueStore.getState().filter.sortOrder).toBe("asc");
  });

  it("toggling direction from the default promotes it to an explicit selection", async () => {
    const user = userEvent.setup();
    render(<SortControl />);
    await user.click(screen.getByTestId("sort-direction-toggle"));
    const { sortField, sortOrder } = useIssueStore.getState().filter;
    expect(sortField).toBe("priority"); // promoted from implicit default
    expect(sortOrder).toBe("asc"); // default desc flipped
  });

  it("toggles direction in place for an explicit selection", async () => {
    useIssueStore.setState({
      filter: { sortField: "priority", sortOrder: "desc" },
    });
    const user = userEvent.setup();
    render(<SortControl />);
    await user.click(screen.getByTestId("sort-direction-toggle"));
    expect(useIssueStore.getState().filter.sortField).toBe("priority");
    expect(useIssueStore.getState().filter.sortOrder).toBe("asc");
  });

  it("reset clears BOTH sortField and sortOrder back to pristine default", async () => {
    useIssueStore.setState({
      filter: { sortField: "due_date", sortOrder: "asc" },
    });
    const user = userEvent.setup();
    render(<SortControl />);
    await user.click(screen.getByTestId("sort-control-trigger"));
    await user.click(screen.getByTestId("sort-reset"));
    const { sortField, sortOrder } = useIssueStore.getState().filter;
    // An orphaned sortOrder would still serialize to the URL (order=…) and
    // IndexedDB, so the filter should be fully pristine after reset.
    expect(sortField).toBeUndefined();
    expect(sortOrder).toBeUndefined();
  });

  it("does not offer a reset while pristine", async () => {
    const user = userEvent.setup();
    render(<SortControl />);
    await user.click(screen.getByTestId("sort-control-trigger"));
    expect(screen.queryByTestId("sort-reset")).toBeNull();
  });

  // REEF-169 — on the backlog the pristine state is `rank` order, and
  // this control is the single place that names it.
  describe("backlog rank order (supportsRankOrder)", () => {
    it("keeps Rank 기준 as the shared label and 드래그 as backlog-only copy", async () => {
      const user = userEvent.setup();
      render(
        <IntlTestProvider locale="ko">
          <SortControl supportsRankOrder showsBacklogReorderHint />
        </IntlTestProvider>,
      );

      expect(screen.getByTestId("sort-control-trigger")).toHaveTextContent(
        "Rank 기준",
      );
      await user.click(screen.getByTestId("sort-control-trigger"));
      expect(screen.getByTestId("sort-option-rank")).toHaveTextContent(
        "드래그",
      );
    });

    it("shows Rank order — not the muted Priority default — when pristine", () => {
      render(<SortControl supportsRankOrder showsBacklogReorderHint />);
      const trigger = screen.getByTestId("sort-control-trigger");
      expect(trigger.textContent).toContain("Rank order");
      expect(trigger.textContent).not.toContain("Priority");
      // Rank order has no asc/desc the user controls, so no direction toggle.
      expect(screen.queryByTestId("sort-direction-toggle")).toBeNull();
      // Still pristine — nothing leaked into the store.
      expect(useIssueStore.getState().filter.sortField).toBeUndefined();
    });

    it("offers Rank order as a first-class option that clears an active sort", async () => {
      useIssueStore.setState({
        filter: { sortField: "updated_at", sortOrder: "desc" },
      });
      const user = userEvent.setup();
      render(<SortControl supportsRankOrder showsBacklogReorderHint />);
      await user.click(screen.getByTestId("sort-control-trigger"));
      expect(screen.getByTestId("sort-option-rank")).toHaveTextContent("Drag");
      await user.click(screen.getByTestId("sort-option-rank"));
      // The single shared clearSort wipes BOTH halves (REEF-169 / REEF-057).
      expect(useIssueStore.getState().filter.sortField).toBeUndefined();
      expect(useIssueStore.getState().filter.sortOrder).toBeUndefined();
    });

    it("omits the separate Reset item — Rank order is the reset", async () => {
      useIssueStore.setState({
        filter: { sortField: "due_date", sortOrder: "asc" },
      });
      const user = userEvent.setup();
      render(<SortControl supportsRankOrder showsBacklogReorderHint />);
      await user.click(screen.getByTestId("sort-control-trigger"));
      expect(screen.queryByTestId("sort-reset")).toBeNull();
      expect(screen.getByTestId("sort-option-rank")).toBeInTheDocument();
    });
  });

  describe("board rank order (supportsRankOrder)", () => {
    it("shows Rank order — not the muted Priority default — when pristine", () => {
      render(<SortControl supportsRankOrder />);
      const trigger = screen.getByTestId("sort-control-trigger");
      expect(trigger.textContent).toContain("Rank order");
      expect(trigger.textContent).not.toContain("Priority");
      expect(screen.queryByTestId("sort-direction-toggle")).toBeNull();
      expect(useIssueStore.getState().filter.sortField).toBeUndefined();
    });

    it("offers Rank order as the reset for an active board sort", async () => {
      useIssueStore.setState({
        filter: { sortField: "updated_at", sortOrder: "desc" },
      });
      const user = userEvent.setup();
      render(<SortControl supportsRankOrder />);
      await user.click(screen.getByTestId("sort-control-trigger"));
      expect(screen.getByTestId("sort-option-rank")).not.toHaveTextContent(
        "Drag",
      );
      await user.click(screen.getByTestId("sort-option-rank"));
      expect(useIssueStore.getState().filter.sortField).toBeUndefined();
      expect(useIssueStore.getState().filter.sortOrder).toBeUndefined();
      expect(screen.queryByTestId("sort-reset")).toBeNull();
    });
  });
});
