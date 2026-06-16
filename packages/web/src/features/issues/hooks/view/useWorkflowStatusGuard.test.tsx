import { useIssueStore } from "@/features/issues/stores/useIssueStore";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkflowStatusGuard } from "./useWorkflowStatusGuard";

describe("useWorkflowStatusGuard (REEF-109)", () => {
  beforeEach(() => {
    useIssueStore.setState({
      filter: {},
      searchQuery: "",
      selectedIssueId: null,
    });
  });

  it("strips backlog while keeping workflow statuses", async () => {
    useIssueStore.setState({ filter: { status: ["backlog", "todo"] } });
    renderHook(() => useWorkflowStatusGuard());
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toEqual(["todo"]);
    });
  });

  it("drops the status facet entirely when only backlog was selected", async () => {
    useIssueStore.setState({ filter: { status: ["backlog"] } });
    renderHook(() => useWorkflowStatusGuard());
    await waitFor(() => {
      expect(useIssueStore.getState().filter.status).toBeUndefined();
    });
  });

  it("leaves a workflow-only filter untouched", () => {
    useIssueStore.setState({ filter: { status: ["todo", "in_progress"] } });
    renderHook(() => useWorkflowStatusGuard());
    // No non-workflow members → the effect makes no change.
    expect(useIssueStore.getState().filter.status).toEqual([
      "todo",
      "in_progress",
    ]);
  });
});
