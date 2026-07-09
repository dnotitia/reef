import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  // REEF-169 — on the backlog the pristine state is the manual `rank` order, and
  // this control is the single place that names it.
  describe("backlog manual order (supportsManualOrder)", () => {
    it("shows Manual order — not the muted Priority default — when pristine", () => {
      render(<SortControl supportsManualOrder />);
      const trigger = screen.getByTestId("sort-control-trigger");
      expect(trigger.textContent).toContain("Manual order");
      expect(trigger.textContent).not.toContain("Priority");
      // Manual order has no asc/desc the user controls, so no direction toggle.
      expect(screen.queryByTestId("sort-direction-toggle")).toBeNull();
      // Still pristine — nothing leaked into the store.
      expect(useIssueStore.getState().filter.sortField).toBeUndefined();
    });

    it("offers Manual order as a first-class option that clears an active sort", async () => {
      useIssueStore.setState({
        filter: { sortField: "updated_at", sortOrder: "desc" },
      });
      const user = userEvent.setup();
      render(<SortControl supportsManualOrder />);
      await user.click(screen.getByTestId("sort-control-trigger"));
      await user.click(screen.getByTestId("sort-option-manual"));
      // The single shared clearSort wipes BOTH halves (REEF-169 / REEF-057).
      expect(useIssueStore.getState().filter.sortField).toBeUndefined();
      expect(useIssueStore.getState().filter.sortOrder).toBeUndefined();
    });

    it("omits the separate Reset item — Manual order is the reset", async () => {
      useIssueStore.setState({
        filter: { sortField: "due_date", sortOrder: "asc" },
      });
      const user = userEvent.setup();
      render(<SortControl supportsManualOrder />);
      await user.click(screen.getByTestId("sort-control-trigger"));
      expect(screen.queryByTestId("sort-reset")).toBeNull();
      expect(screen.getByTestId("sort-option-manual")).toBeInTheDocument();
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
      await user.click(screen.getByTestId("sort-option-rank"));
      expect(useIssueStore.getState().filter.sortField).toBeUndefined();
      expect(useIssueStore.getState().filter.sortOrder).toBeUndefined();
      expect(screen.queryByTestId("sort-reset")).toBeNull();
    });
  });
});
