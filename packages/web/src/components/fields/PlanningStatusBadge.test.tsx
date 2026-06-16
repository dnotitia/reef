import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlanningStatusBadge, planningStatusMeta } from "./PlanningStatusBadge";

describe("PlanningStatusBadge", () => {
  it("renders the human label, never the raw enum identifier", () => {
    render(<PlanningStatusBadge kind="releases" status="in_progress" />);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText("in_progress")).not.toBeInTheDocument();
  });

  it("maps each kind/status onto a shared status color token", () => {
    expect(planningStatusMeta("sprints", "active").colorClass).toBe(
      "text-status-in-progress",
    );
    expect(planningStatusMeta("sprints", "planned").colorClass).toBe(
      "text-status-open",
    );
    expect(planningStatusMeta("milestones", "closed").colorClass).toBe(
      "text-status-done",
    );
    expect(planningStatusMeta("releases", "released").colorClass).toBe(
      "text-status-done",
    );
  });

  it("falls back to the raw value + neutral color for an unknown status", () => {
    const meta = planningStatusMeta("sprints", "mystery");
    expect(meta.label).toBe("mystery");
    expect(meta.colorClass).toBe("text-status-closed");
  });
});
